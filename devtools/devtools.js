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
  const NAV_DOC_FRESH_MS = 1500; // 내비게이션 매칭 문서 entry의 최대 허용 나이(reload 오매칭 방지)
  const NAV_DEDUPE_MS = 5000; // NAV_COMMITTED 로 이미 처리한 내비게이션의 뒤늦은 onNavigated 무시 구간

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
  // 현재 페이지의 문서 요청 entry — 다음 내비게이션에서 "이번 페이지의 문서" 를 찾을 때
  // 후보에서 제외한다(같은 URL 재로드 시 이전 로드분이 경계로 뽑히는 것을 막는다).
  let currentDocEntry = null;
  // 내비게이션 직후 문서 entry 도착을 기다리는 URL — 도착하면 currentDocEntry 로 표시한다.
  let pendingDocUrl = null;
  // NAV_COMMITTED 로 정리를 끝낸 내비게이션 — 같은 내비게이션의 뒤늦은 onNavigated 를 가려낸다.
  let lastCommitNav = { url: "", at: 0 };
  // 직전에 확인한 inspected 페이지의 performance.timeOrigin — 문서가 교체될 때만 값이 바뀌므로
  // same-document 이동(history.pushState / hash 변경) 판별 기준으로 쓴다.
  let lastTimeOrigin = null;

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
  // 잘려나가는 entry의 fetchUrl은 ownFetchUrls에서도 함께 제거해야 한다 — 안 그러면 그 URL이
  // Set에 영구히 남아 계속 누적된다.
  function trimEntries() {
    if (entries.length > maxEntries) {
      const removed = entries.splice(0, entries.length - maxEntries);
      removed.forEach((entry) => {
        ownFetchUrls.delete(entry.fetchUrl);
        if (entry === currentDocEntry) currentDocEntry = null;
      });
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

    try {
      port.postMessage({
        type: MSG.REGISTER,
        tabId: ext.devtools.inspectedWindow.tabId,
      });
      // SW 재시작 후 재연결이면 background의 캡쳐 승격 상태가 사라졌으므로 표시 중일 때 다시 승격한다.
      if (panelVisible) {
        port.postMessage({ type: MSG.PANEL_SHOWN });
      }
    } catch (err) {
      // port 가 connect() 직후 곧바로 무효화된 경우 — onDisconnect 를 기다리지 않고
      // 기존 재연결 예약 경로로 넘긴다(안 그러면 재연결 없이 여기서 멈춘다).
      console.error("[NovaDebug] REGISTER/PANEL_SHOWN 전송 실패", err);
      scheduleReconnect();
      return;
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
    // schemaVersion===2 라도 summary(혹은 summary.queries/slow)가 없는 페이로드가 있을 수 있어
    // 방어적으로 접근한다(그렇지 않으면 entry.data/entry.error 가 혼재된 상태로 TypeError).
    const queries = data.summary && data.summary.queries;
    return {
      queryCount: queries ? queries.count : 0,
      slowCount: (queries && queries.slow) ? queries.slow.count : 0,
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
    // 직전 내비게이션이 기다리던 문서 요청이면 표시해 둔다 — 다음 내비게이션의 경계 탐색에서
    // 이 entry 를 후보에서 빼야 같은 URL 재로드 시 이전 로드분이 경계로 뽑히지 않는다.
    if (pendingDocUrl !== null && stripFragment(entry.url) === pendingDocUrl) {
      currentDocEntry = entry;
      pendingDocUrl = null;
    }

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

  // 내비게이션 정리 — 이전 페이지 소속 entry만 제거하고 새 페이지 소속은 남긴다.
  //
  // 새 페이지의 문서 entry는 이 정리보다 먼저 도착해 있을 수 있다(Firefox 는 onNavigated 가
  // 문서 요청 완료보다 관찰상 ~700ms 늦게 발화하고, 커밋 릴레이 경로도 극소형 응답에서는
  // 문서 entry 뒤에 도착할 수 있다). entries 는 시간순 append 이므로 그 문서 entry의 인덱스를
  // 경계로 삼아 앞쪽만 제거하면 문서 entry와 그 뒤에 이미 붙은 새 페이지 ajax entry가 보존된다.
  //
  // 경계 후보는 (a) navigate 된 URL과 같고 (b) 방금(NAV_DOC_FRESH_MS 이내) 추가됐으며
  // (c) 현재 페이지의 문서 entry가 아닌 것 중 가장 이른 것이다.
  // - (b) 는 같은 URL 재로드에서 이전 로드분이 경계로 뽑히는 것을 막는다.
  // - (c) 는 그 중에서도 fresh 조건에 걸리는 직전 로드의 문서 entry를 후보에서 뺀다.
  // - "가장 이른 것" 이어야 페이지와 같은 URL로 보내는 ajax(POST 폼 전송 등)가 경계가 되어
  //   그 앞의 문서 entry가 잘려나가는 것을 막을 수 있다.
  function pruneForNavigation(url) {
    const navigatedUrl = stripFragment(url);
    const now = Date.now();
    let docIndex = -1;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry === currentDocEntry) continue;
      if (stripFragment(entry.url) !== navigatedUrl) continue;
      if (now - entry.time.getTime() > NAV_DOC_FRESH_MS) continue;
      docIndex = i;
      break;
    }

    if (docIndex === -1) {
      entries.length = 0;
      currentDocEntry = null;
      pendingDocUrl = navigatedUrl; // 뒤이어 도착할 문서 entry를 표시하기 위해
    } else {
      entries.splice(0, docIndex);
      currentDocEntry = entries[0];
      pendingDocUrl = null;
    }

    ownFetchUrls.clear();
    entries.forEach((entry) => ownFetchUrls.add(entry.fetchUrl));
    notify();
  }

  // inspected 페이지에서 식을 평가한다. 반환 형태가 다르다: Chrome 은 callback(result,
  // exceptionInfo), Firefox 는 promise([result, errorInfo]).
  function evalInPage(expr) {
    if (isFirefox) {
      return ext.devtools.inspectedWindow
        .eval(expr)
        .then((res) => (Array.isArray(res) ? res[0] : res));
    }
    return new Promise((resolve) => {
      ext.devtools.inspectedWindow.eval(expr, (result) => resolve(result));
    });
  }

  // 문서가 실제로 교체됐는지 — performance.timeOrigin 은 문서마다 새로 부여되므로 값이 그대로면
  // history.pushState/hash 이동 같은 same-document 내비게이션이다. 이때 목록을 비우면 현재
  // 보고 있는 페이지의 로그를 잃으므로 정리하지 않는다. 판별에 실패하면(값 없음/평가 불가)
  // 문서 교체로 간주해 기존 동작(정리)을 유지한다.
  function checkDocumentReplaced() {
    return evalInPage("performance.timeOrigin")
      .then((origin) => {
        if (typeof origin !== "number") {
          lastTimeOrigin = null;
          return true;
        }
        const replaced = origin !== lastTimeOrigin;
        lastTimeOrigin = origin;
        return replaced;
      })
      .catch(() => {
        lastTimeOrigin = null;
        return true;
      });
  }

  ext.devtools.network.onNavigated.addListener((url) => {
    pageUrl = url;
    notify(); // 목록과 별개로 패널의 현재 호스트 표시(캡쳐 설정)는 항상 갱신

    // 같은 내비게이션을 NAV_COMMITTED 가 이미 커밋 시점에 정리했다면 여기서 다시 정리하지
    // 않는다. 이 시점에는 새 페이지의 문서 entry와 ajax entry가 이미 목록에 있어, 다시
    // 경계를 찾으면 페이지와 같은 URL로 보낸 ajax 가 경계가 되어 문서 entry가 잘려나간다.
    const deduped =
      stripFragment(url) === lastCommitNav.url &&
      Date.now() - lastCommitNav.at <= NAV_DEDUPE_MS;

    // dedupe 되거나 preserveLog 중이라도 다음 판별 기준이 되는 timeOrigin 은 갱신해야 한다.
    checkDocumentReplaced().then((replaced) => {
      if (deduped || preserveLog || !replaced) return;
      pruneForNavigation(url);
    });
  });

  // background 가 webNavigation.onCommitted 를 릴레이한 것(Firefox 전용, 위 onNavigated 보다
  // 훨씬 이르게 도착) — 커밋 시점에 이전 페이지 entry를 미리 정리해 Chromium과 비슷한 체감을
  // 준다. webNavigation.onCommitted 는 same-document 이동에는 발화하지 않으므로 별도 판별 없이
  // 곧바로 정리한다.
  function handleNavCommitted(url) {
    pageUrl = url;
    lastCommitNav = { url: stripFragment(url), at: Date.now() };
    if (preserveLog) {
      notify();
      return;
    }
    pruneForNavigation(url);
  }

  function clear() {
    entries.length = 0;
    ownFetchUrls.clear();
    currentDocEntry = null;
    pendingDocUrl = null;
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
  // 현재 문서의 timeOrigin 을 미리 기록해 둔다 — 첫 내비게이션이 same-document 이동(pushState)
  // 이어도 기준값이 없어 문서 교체로 오판하지 않도록.
  checkDocumentReplaced();

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
