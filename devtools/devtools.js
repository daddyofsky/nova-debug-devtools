/*
 * Nova Debug — devtools_page
 *
 * DevTools 오픈 즉시 로드되는 컨텍스트라는 점을 이용해 수집 계층(port 연결/REGISTER,
 * 네트워크 응답 헤더 감지, background 경유 fetch, entries 버퍼)을 여기서 소유한다.
 * panel/panel.js 는 Nova Debug 탭이 실제로 선택되어야만 로드되므로, 그 전에 로드된
 * 계층에 두어야 "패널을 열지 않아도 확장 모드로 전환" 이 보장된다.
 * 패널은 열릴 때(panel.onShown)마다 window.__novaAttach(shared) 로 이 상태를 주입받는다.
 */
(function () {
  const ext = NovaDebugProtocol.ext;
  const PORT_NAME = NovaDebugProtocol.PORT_NAME;
  const MSG = NovaDebugProtocol.MSG;
  const ID_HEADER = NovaDebugProtocol.ID_HEADER.toLowerCase();
  const STORAGE_KEYS = NovaDebugProtocol.STORAGE_KEYS;

  const RECONNECT_DELAY_MS = 300;
  const RECONNECT_MAX_DELAY_MS = 5000;
  const HEARTBEAT_INTERVAL_MS = 15000; // background(SW/event page) idle 타임아웃(통상 30s)보다 짧게 유지
  const HEARTBEAT_TIMEOUT_MS = 10000;
  const NAV_COMMITTED_FRESH_MS = 1500; // NAV_COMMITTED 매칭 entry의 최대 허용 나이(reload 오매칭 방지)

  const entries = [];
  const listeners = new Set();
  let preserveLog = false;
  let status = "connecting...";
  let port = null;
  let reconnectAttempts = 0;
  let connGen = 0; // 재연결 시 이전 port 의 지연된 onDisconnect/onMessage 를 무시하기 위한 세대 토큰
  let heartbeatTimer = null;
  let heartbeatTimeoutTimer = null;
  let maxEntries = 100;
  // fetch 경로/토큰 유효 설정 계산에 쓰는 원본 storage 값 — NovaDebugProtocol.effectiveFetchPath/
  // effectiveToken(origin, novaConfig) 로 소비한다.
  let novaConfig = { hostMap: {}, token: "" };
  // 패널이 현재 표시 중인지 — 캡쳐는 패널이 표시된 동안만(onShown 승격/onHidden 해제).
  // background(SW/event page) 재시작 후 재연결 시 현재 표시 상태를 다시 보내야 하므로
  // devtools 수명 동안 플래그로 유지한다.
  let panelVisible = false;
  // inspected 페이지의 현재 URL — 패널의 사이트별 캡쳐 설정(captureOnOpen 체크박스)이
  // 어느 호스트를 가리키는지 판별하는 데 쓴다. 초기값은 eval, 이후 내비게이션 시 갱신.
  let pageUrl = "";

  function storageArea() {
    return ext.storage.sync || ext.storage.local;
  }

  function loadNovaConfig() {
    return Promise.all([
      NovaDebugProtocol.loadHostMap(storageArea()),
      storageArea().get(STORAGE_KEYS.TOKEN),
    ])
      .then(([hostMap, tokenRes]) => {
        novaConfig = {
          hostMap,
          token: (tokenRes && tokenRes[STORAGE_KEYS.TOKEN]) || "",
        };
      })
      .catch((err) => {
        console.error("[NovaDebug] fetch 설정 로드 실패", err);
      });
  }

  // entries 는 panel.js 가 참조를 공유하므로 length=0 방식이 아니라 splice로 앞에서(오래된 것부터) 제거한다.
  function trimEntries() {
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }
  }

  function loadMaxEntries() {
    storageArea()
      .get("maxEntries")
      .then((res) => {
        const val = res && res.maxEntries;
        maxEntries = (typeof val === "number" && val > 0) ? val : 100;
        trimEntries();
        notify();
      })
      .catch((err) => {
        console.error("[NovaDebug] maxEntries 로드 실패", err);
      });
  }

  if (ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (changes.maxEntries) {
        const val = changes.maxEntries.newValue;
        maxEntries = (typeof val === "number" && val > 0) ? val : 100;
        trimEntries();
        notify();
      }
      if (changes[STORAGE_KEYS.HOST_MAP] || changes[STORAGE_KEYS.TOKEN]) {
        loadNovaConfig();
      }
    });
  }

  // background 가 우리 자신의 dump 조회 요청(fetchViaBackground/fetchViaTab)을 다시
  // "새 요청"으로 감지해 entries 에 재등록하는 재귀를 막기 위한 자기 요청 URL 추적.
  const ownFetchUrls = new Set();

  // devtools_page 의 runtime 은 부분 노출이라(ext.tabs 부재와 같은 원리) getBrowserInfo 같은
  // 메서드가 없을 수 있어, devtools_page 를 포함한 모든 확장 컨텍스트에 존재하는 browser
  // 전역(Chrome 에는 없음) 유무로 판별한다. lib/protocol.js 의 ext = root.browser || chrome
  // 선택과 동일한 기준이다.
  const isFirefox = typeof browser !== "undefined";

  // fragment(#hash)만 제거해 비교 — 쿼리스트링은 유지한다.
  function stripFragment(url) {
    try {
      const u = new URL(url);
      u.hash = "";
      return u.href;
    } catch (err) {
      return url;
    }
  }

  function notify() {
    listeners.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.error("[NovaDebug] onChange 리스너 오류", err);
      }
    });
  }

  function setStatus(text) {
    status = text;
    notify();
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  // ------------------------------------------------------------
  // Port / fetch
  // ------------------------------------------------------------

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (heartbeatTimeoutTimer) {
      clearTimeout(heartbeatTimeoutTimer);
      heartbeatTimeoutTimer = null;
    }
  }

  // background 가 유휴 종료 후 재시작되면 등록 상태(activeTabs 등)를 잃는다.
  // 정상적으로는 port.onDisconnect 가 이를 감지해 재연결하지만, 그 이벤트가 지연/누락되면
  // (Firefox 에서 관찰됨) devtools 패널은 죽은 port 를 산 것으로 착각해 REGISTER 를 다시 보내지
  // 않는다 — heartbeat 로 이를 능동적으로 감지해 강제 재연결한다.
  function startHeartbeat(myGen) {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (myGen !== connGen || !port) return;
      try {
        port.postMessage({ type: MSG.PING });
      } catch (err) {
        return; // 전송 실패는 onDisconnect 가 곧 처리
      }
      // 이전 사이클의 timeout 이 아직 안 지워졌다면(PONG 지연) 먼저 정리하고 새로 건다 —
      // 안 그러면 이전 timeout 이 고아 상태로 남아 정상 연결에서도 오탐 재연결을 유발할 수 있다.
      if (heartbeatTimeoutTimer) clearTimeout(heartbeatTimeoutTimer);
      heartbeatTimeoutTimer = setTimeout(() => {
        if (myGen !== connGen) return;
        forceReconnect();
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function scheduleReconnect() {
    reconnectAttempts++;
    setStatus("reconnecting...");
    const delay = Math.min(RECONNECT_DELAY_MS * reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    setTimeout(connectPort, delay);
  }

  // heartbeat 무응답 시 강제 재연결 — onDisconnect 를 기다리지 않고 새 port 로 교체한다.
  function forceReconnect() {
    connGen++;
    stopHeartbeat();
    try {
      if (port) port.disconnect();
    } catch (err) {
      // no-op — 이미 죽은 port 일 수 있음
    }
    setStatus("reconnecting...");
    setTimeout(connectPort, RECONNECT_DELAY_MS);
  }

  function connectPort() {
    const myGen = ++connGen;
    try {
      port = ext.runtime.connect({ name: PORT_NAME });
    } catch (err) {
      console.error("[NovaDebug] port 연결 실패", err);
      scheduleReconnect();
      return;
    }

    port.postMessage({
      type: MSG.REGISTER,
      tabId: ext.devtools.inspectedWindow.tabId,
    });
    // SW 재시작 후 재연결이면 background의 캡쳐 승격 상태가 사라졌으므로 표시 중일 때 다시 승격한다.
    if (panelVisible) {
      port.postMessage({ type: MSG.PANEL_SHOWN });
    }

    reconnectAttempts = 0;
    setStatus("listening (tab " + ext.devtools.inspectedWindow.tabId + ")");
    startHeartbeat(myGen);

    port.onMessage.addListener((msg) => {
      if (myGen !== connGen || !msg) return;
      if (msg.type === MSG.PONG && heartbeatTimeoutTimer) {
        clearTimeout(heartbeatTimeoutTimer);
        heartbeatTimeoutTimer = null;
      }
      if (msg.type === MSG.NAV_COMMITTED) {
        handleNavCommitted(msg.url);
      }
    });

    port.onDisconnect.addListener(() => {
      if (myGen !== connGen) return; // forceReconnect 등으로 이미 교체된 이전 port 의 지연 이벤트
      stopHeartbeat();
      scheduleReconnect();
    });
  }

  async function fetchViaBackground(url, headerValue) {
    let response;
    try {
      response = await ext.runtime.sendMessage({
        type: MSG.FETCH,
        url,
        headerValue,
        tabId: ext.devtools.inspectedWindow.tabId,
      });
    } catch (err) {
      throw new Error(String((err && err.message) || err));
    }
    if (!response) {
      throw new Error("background 응답 없음");
    }
    if (!response.ok) {
      throw new Error(response.error || "fetch 실패");
    }
    return response.data;
  }

  function findHeader(headers, nameLc) {
    if (!headers) return null;
    for (const h of headers) {
      if (h.name && h.name.toLowerCase() === nameLc) return h.value;
    }
    return null;
  }

  function computeStats(data) {
    if (!data || data.schemaVersion !== 2) {
      return { queryCount: 0, slowCount: 0, hasError: false, hasRedirect: false };
    }
    let hasError = false;
    let hasRedirect = false;
    (data.entries || []).forEach((item) => {
      if (item.label && /ERROR|Exception/i.test(item.label)) hasError = true;
      if (item.label && /REDIRECT/i.test(item.label)) hasRedirect = true;
    });
    return {
      queryCount: data.summary.queries.count,
      slowCount: data.summary.queries.slow.count,
      hasError,
      hasRedirect,
    };
  }

  function retryFetch(entry) {
    entry.retrying = true;
    notify();
    ownFetchUrls.add(entry.fetchUrl);
    const headerValue = NovaDebugProtocol.effectiveToken(entry.origin, novaConfig);
    fetchViaBackground(entry.fetchUrl, headerValue)
      .then((data) => {
        entry.data = data;
        entry.stats = computeStats(data);
        entry.error = null;
        entry.retrying = false;
        notify();
      })
      .catch((err) => {
        entry.error = String(err.message || err);
        entry.retrying = false;
        notify();
      });
  }

  // ------------------------------------------------------------
  // 네트워크 캡처
  // ------------------------------------------------------------

  ext.devtools.network.onRequestFinished.addListener((request) => {
    // 우리 자신이 조회를 위해 보낸 dump-fetch 요청이 다시 캡처된 경우 — 서버가 그 응답에도
    // X-Nova-Debug-Id 헤더를 붙이면 무한 재감지 루프가 될 수 있어 여기서 차단한다.
    if (ownFetchUrls.has(request.request.url)) return;

    const headers = request.response && request.response.headers;
    const id = findHeader(headers, ID_HEADER);
    if (!id) return;

    // X-Nova-Debug-Fetch 응답 헤더 폐지(서버 내부 경로 노출 방지) — 확장 자체 설정(origin별
    // fetchPath 오버라이드 + 기본 경로)으로 조회 URL을 구성한다.
    let origin;
    try {
      origin = new URL(request.request.url).origin;
    } catch (err) {
      console.error("[NovaDebug] 요청 URL origin 파싱 실패", request.request.url, err);
      return;
    }
    const basePath = NovaDebugProtocol.effectiveFetchPath(origin, novaConfig);
    if (!basePath) {
      console.error("[NovaDebug] fetch 경로 설정이 올바르지 않습니다", origin, novaConfig);
      return;
    }
    let fetchUrl;
    try {
      const u = new URL(basePath);
      u.searchParams.set("fetch", id);
      fetchUrl = u.href;
    } catch (err) {
      console.error("[NovaDebug] fetch URL 구성 실패", basePath, err);
      return;
    }
    const headerValue = NovaDebugProtocol.effectiveToken(origin, novaConfig);

    const entry = {
      id,
      method: request.request.method,
      url: request.request.url,
      origin,
      status: request.response.status,
      time: new Date(),
      data: null,
      stats: null,
      error: null,
      retrying: false,
      fetchUrl,
    };
    entries.push(entry);
    trimEntries();
    notify();

    ownFetchUrls.add(fetchUrl);
    fetchViaBackground(fetchUrl, headerValue)
      .then((data) => {
        entry.data = data;
        entry.stats = computeStats(data);
        notify();
      })
      .catch((err) => {
        entry.error = String(err.message || err);
        notify();
      });
  });

  function sendPanelVisibility(visible) {
    if (panelVisible === visible) return;
    panelVisible = visible;
    if (!port) return;
    try {
      port.postMessage({ type: visible ? MSG.PANEL_SHOWN : MSG.PANEL_HIDDEN });
    } catch (err) {
      // port가 죽어 있으면 재연결 경로(connectPort)가 panelVisible 플래그로 현재 상태를 다시 보낸다
    }
  }

  ext.devtools.network.onNavigated.addListener((url) => {
    pageUrl = url;
    if (preserveLog) {
      notify(); // 목록은 유지하되 패널의 현재 호스트 표시(캡쳐 설정)는 갱신
      return;
    }

    // Firefox 는 onNavigated 가 문서 요청 완료(entry 추가)보다 한참 뒤(관찰상 ~700ms 지연)
    // 발화되어, 전체 clear 시 방금 추가된 문서 entry는 물론 그 뒤에 이미 붙은 새 페이지의
    // ajax entry들까지 지워진다(Chromium 은 커밋 시점에 먼저 발화되어 clear 시점엔 아직
    // entry 가 없으므로 전체 clear가 안전). entries 는 시간순 append 이므로, navigate 된
    // URL과 일치하는 가장 최근 occurrence의 인덱스를 찾아 그 인덱스부터 끝까지(문서 entry +
    // 그 뒤에 붙은 새 페이지 소속 entry 전부)를 보존하고, 그 앞(이전 페이지 소속, reload라면
    // 이전 로드분 포함)만 제거한다.
    if (isFirefox) {
      const navigatedUrl = stripFragment(url);
      let matchedIndex = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (stripFragment(entries[i].url) === navigatedUrl) {
          matchedIndex = i;
          break;
        }
      }
      entries.splice(0, matchedIndex === -1 ? entries.length : matchedIndex);
      ownFetchUrls.clear();
      entries.forEach((entry) => ownFetchUrls.add(entry.fetchUrl));
      notify();
      return;
    }

    entries.length = 0;
    ownFetchUrls.clear();
    notify();
  });

  // background 가 webNavigation.onCommitted 를 릴레이한 것(Firefox 전용, 위 onNavigated 보다
  // 훨씬 이르게 도착) — 커밋 시점에 이전 페이지 entry를 미리 정리해 Chromium과 비슷한 체감을
  // 준다. freshness(NAV_COMMITTED_FRESH_MS) 조건 없이 URL만 매칭하면 reload(같은 URL 재로드)
  // 때 이전 로드의 entry가 매칭되어 잘못 보존되므로, 방금(1.5초 이내) 추가된 entry만 매칭
  // 대상으로 삼는다. 이 레이스(커밋 메시지가 문서 requestFinished 보다 늦게 도착하는 극소형
  // 응답 등)에서 방금 추가된 문서 entry를 지우지 않도록 보호하는 목적도 겸한다.
  // 빠른 연속 reload(<1.5s)로 이전 entry가 fresh 조건에 걸려 잘못 남더라도, 늦게 도착하는
  // 기존 onNavigated 핸들러(위, keep-from-latest-match)가 최신 로드분만 남기며 자가 교정한다.
  function handleNavCommitted(url) {
    pageUrl = url;
    if (preserveLog) {
      notify();
      return;
    }
    const navigatedUrl = stripFragment(url);
    const now = Date.now();
    let matchedIndex = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (stripFragment(entry.url) === navigatedUrl && now - entry.time.getTime() <= NAV_COMMITTED_FRESH_MS) {
        matchedIndex = i;
        break;
      }
    }
    entries.splice(0, matchedIndex === -1 ? entries.length : matchedIndex);
    ownFetchUrls.clear();
    entries.forEach((entry) => ownFetchUrls.add(entry.fetchUrl));
    notify();
  }

  function clear() {
    entries.length = 0;
    ownFetchUrls.clear();
    notify();
  }

  function setPreserveLog(enabled) {
    preserveLog = !!enabled;
  }

  const shared = {
    entries,
    onChange,
    clear,
    setPreserveLog,
    retryFetch,
    getStatus: () => status,
    getPageUrl: () => pageUrl,
  };

  // ------------------------------------------------------------
  // 패널 등록 — 열릴 때마다 공유 상태를 주입한다 (윈도우당 최초 1회만)
  // ------------------------------------------------------------

  const attachedWindows = new WeakSet();

  // Chrome 은 확장 루트 기준, Firefox 는 devtools_page(devtools/) 기준으로 상대경로를 해석하므로
  // 루트 절대경로로 지정해 양쪽 모두 동일하게 동작하도록 한다.
  // panels.create 는 devtools 오픈 시 1회만 실행되어 이후 테마가 바뀌어도 아이콘을 갱신할 수 없으므로,
  // 생성 시점의 테마 기준으로 dark 배경에서도 묻히지 않는 반전 아이콘을 선택한다.
  const panelIcon =
    ext.devtools.panels.themeName === "dark"
      ? "/icons/icon32-invert.png"
      : "/icons/icon32.png";
  ext.devtools.panels.create("Nova Debug", panelIcon, "/panel/panel.html", (panel) => {
    panel.onShown.addListener((win) => {
      sendPanelVisibility(true);
      if (attachedWindows.has(win)) return;
      attachedWindows.add(win);
      if (typeof win.__novaAttach === "function") win.__novaAttach(shared);
    });
    panel.onHidden.addListener(() => {
      sendPanelVisibility(false);
    });
  });

  connectPort();
  loadMaxEntries();
  loadNovaConfig();

  // 초기 URL — 내비게이션 이벤트가 오기 전(패널을 바로 열었을 때)에도 현재 호스트를 알 수 있도록.
  // eval 반환 형태가 다르다: Chrome 은 callback(result), Firefox 는 promise([result, errorInfo]).
  // Firefox 에 callback 을 넘기면 무시되어 pageUrl 이 빈 값으로 남고, 패널의 사이트별 캡쳐
  // 체크박스가 "허용 호스트 아님"(비활성)으로 잘못 표시된다.
  function applyInitialPageUrl(result) {
    if (typeof result === "string" && !pageUrl) {
      pageUrl = result;
      notify();
    }
  }
  if (isFirefox) {
    ext.devtools.inspectedWindow
      .eval("location.href")
      .then((res) => applyInitialPageUrl(Array.isArray(res) ? res[0] : res))
      .catch((err) => console.error("[NovaDebug] 초기 URL 조회 실패", err));
  } else {
    ext.devtools.inspectedWindow.eval("location.href", applyInitialPageUrl);
  }
})();
