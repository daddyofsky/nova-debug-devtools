/*
 * Nova Debug — background 엔트리
 *
 * Chrome: manifest 의 service_worker 로 이 파일 하나만 지정 → importScripts 로 나머지 로드
 * Firefox: manifest 의 background.scripts 배열이 protocol.js/header-inject.js 를
 *          이 파일보다 먼저 로드하므로 importScripts 는 건너뛴다 (service worker 전용 함수)
 */
if (typeof importScripts === "function") {
  importScripts("../lib/protocol.js", "./header-inject.js", "./icon-state.js");
}

(function (root) {
  const ext = root.NovaDebugProtocol.ext;
  const PORT_NAME = root.NovaDebugProtocol.PORT_NAME;
  const MSG = root.NovaDebugProtocol.MSG;
  const REQUEST_HEADER = root.NovaDebugProtocol.REQUEST_HEADER;
  const STORAGE_KEYS = root.NovaDebugProtocol.STORAGE_KEYS;
  const loadHostMap = root.NovaDebugProtocol.loadHostMap;
  const HeaderInject = root.NovaHeaderInject;

  function storageArea() {
    return ext.storage.sync || ext.storage.local;
  }

  // headerValue: 조회 대상 origin 의 유효 토큰(effectiveToken) — devtools.js 가 계산해 넘긴다.
  // 서버가 fetch 액션도 IP AND ext.tokens(설정 시) 이중 게이트로 검사하므로 협상 헤더와
  // 동일한 X-Nova-Debug 헤더를 조회 요청에도 실어야 한다.
  async function fetchDebugJson(url, headerValue) {
    const headers = headerValue ? { [REQUEST_HEADER]: headerValue } : {};
    const res = await fetch(url, { credentials: "include", headers });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // Firefox 에서 background(event page) fetch 가 NetworkError 로 실패하는 사례 대응 —
  // inspected 탭 페이지 컨텍스트에서 재요청한다. 페이지와 동일 origin 이라 CORS/host
  // permission 과 무관하게 동작한다. executeScript 는 func 이 반환한 promise 를 resolve 한다.
  function fetchViaTab(tabId, url, headerName, headerValue) {
    if (!ext.scripting || typeof ext.scripting.executeScript !== "function") {
      return Promise.reject(new Error("scripting API 사용 불가"));
    }
    return ext.scripting
      .executeScript({
        target: { tabId },
        func: (url, headerName, headerValue) => {
          const headers = headerValue ? { [headerName]: headerValue } : {};
          return fetch(url, { credentials: "include", headers }).then((r) => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
          });
        },
        args: [url, headerName, headerValue],
      })
      .then((results) => {
        const result = results && results[0];
        if (!result) throw new Error("executeScript 결과 없음");
        return result.result;
      });
  }

  // 서비스워커가 유휴 종료됐다가 fetch 요청으로 다시 깨어날 때를 위해
  // one-shot 메시지로 처리한다 (port 는 워커가 죽으면 함께 끊긴다).
  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;

    // popup 의 사이트 on/off 는 DevTools 로 등록된 탭(activeTabs)에만 반영되는
    // storage.onChanged 경로를 안 타므로, 등록 여부와 무관하게 현재 탭에 바로 적용되도록
    // popup 이 직접 이 메시지를 보낸다.
    if (msg.type === MSG.SITE_TOGGLED) {
      // popup 토글은 DevTools 없이 켜는 명시적 의사 표시 — captureOnOpen 설정과 무관하게 바로 캡쳐
      // persist:true — devtools 재연결 경로가 없는 탭이므로 SW 재시작 복원 대상으로 남긴다.
      const action = msg.enabled
        ? HeaderInject.enable(msg.tabId, { capture: true, persist: true })
        : HeaderInject.disable(msg.tabId);
      action
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error("[NovaDebug] 사이트 토글 반영 실패", err);
          sendResponse({ ok: false, error: String((err && err.message) || err) });
        });
      return true;
    }

    if (msg.type === MSG.OPEN_OPTIONS) {
      ext.runtime
        .openOptionsPage()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error("[NovaDebug] 옵션 페이지 열기 실패", err);
          sendResponse({ ok: false, error: String((err && err.message) || err) });
        });
      return true;
    }

    if (msg.type !== MSG.FETCH) return;

    fetchDebugJson(msg.url, msg.headerValue)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((bgErr) => {
        if (typeof msg.tabId !== "number") {
          sendResponse({ ok: false, error: String((bgErr && bgErr.message) || bgErr) });
          return;
        }
        fetchViaTab(msg.tabId, msg.url, REQUEST_HEADER, msg.headerValue)
          .then((data) => sendResponse({ ok: true, data }))
          .catch((tabErr) => {
            sendResponse({
              ok: false,
              error:
                String((bgErr && bgErr.message) || bgErr) +
                " / " +
                String((tabErr && tabErr.message) || tabErr),
            });
          });
      });
    return true; // Chrome: 비동기 sendResponse 를 위해 필수
  });

  // REGISTER 된 tabId → devtools port. webNavigation.onCommitted 를 해당 탭의 devtools
  // 포트로 릴레이하는 데 쓴다(탭당 devtools 포트는 하나).
  const registeredPorts = new Map();

  // Firefox 는 DevTools 닫힘의 port.onDisconnect 가 누락될 수 있고(event page 는 SW 와 달리
  // 오래 살아 stale 상태가 유지됨), 그 사이 헤더 주입이 계속된다. devtools.js 의 heartbeat
  // (15s 간격 PING)를 생존 신호로 삼아, 오래 끊긴 탭을 스윕에서 강제 정리한다.
  const HEARTBEAT_STALE_MS = 45000; // heartbeat 3회분
  const tabLastSeen = new Map(); // tabId → Date.now()

  setInterval(() => {
    const now = Date.now();
    tabLastSeen.forEach((seen, tabId) => {
      if (now - seen <= HEARTBEAT_STALE_MS) return;
      tabLastSeen.delete(tabId);
      if (!registeredPorts.has(tabId)) return;
      registeredPorts.delete(tabId);
      HeaderInject.disable(tabId).catch((err) =>
        console.error("[NovaDebug] stale devtools 탭 정리 실패", err)
      );
    });
  }, 30000);

  ext.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    let tabId = null;

    port.onMessage.addListener((msg) => {
      if (!msg) return;

      if (msg.type === MSG.REGISTER) {
        tabId = msg.tabId;
        registeredPorts.set(tabId, port);
        tabLastSeen.set(tabId, Date.now());
        // DevTools 오픈 단계 — captureOnOpen 호스트에만 주입되고, 나머지 enabled 호스트는
        // PANEL_SHOWN(패널 첫 표시) 승격 후부터 주입된다. capture:false 명시 리셋은
        // onDisconnect 누락으로 남은 이전 세션의 승격을 지우기 위함(header-inject.js 참조).
        HeaderInject.enable(tabId, { capture: false }).catch((err) =>
          console.error("[NovaDebug] header inject enable 실패", err)
        );
        return;
      }

      if (msg.type === MSG.PANEL_SHOWN) {
        if (tabId === null) return;
        tabLastSeen.set(tabId, Date.now());
        HeaderInject.enable(tabId, { capture: true }).catch((err) =>
          console.error("[NovaDebug] 패널 표시 캡쳐 승격 실패", err)
        );
        return;
      }

      // 캡쳐는 패널이 표시된 동안만 — 다른 도구 탭으로 이동하면 오픈 단계(captureOnOpen
      // 호스트만 주입)로 되돌린다.
      if (msg.type === MSG.PANEL_HIDDEN) {
        if (tabId === null) return;
        tabLastSeen.set(tabId, Date.now());
        HeaderInject.enable(tabId, { capture: false }).catch((err) =>
          console.error("[NovaDebug] 패널 숨김 캡쳐 해제 실패", err)
        );
        return;
      }

      // devtools.js 의 heartbeat — 응답만으로 이 이벤트가 idle 타이머를 리셋시키고,
      // devtools 쪽은 응답 유무로 port 가 살아있는 background 에 실제로 닿아있는지 확인한다.
      if (msg.type === MSG.PING) {
        if (tabId !== null) tabLastSeen.set(tabId, Date.now());
        try {
          port.postMessage({ type: MSG.PONG });
        } catch (err) {
          console.error("[NovaDebug] PONG 전송 실패", err);
        }
        return;
      }
    });

    port.onDisconnect.addListener(() => {
      if (tabId === null) return;
      // 재연결 레이스로 이미 새 port 가 같은 tabId 로 등록돼 있을 수 있어, 이 port 가 여전히
      // 현재 등록된 port 일 때만 제거한다.
      if (registeredPorts.get(tabId) === port) {
        registeredPorts.delete(tabId);
        tabLastSeen.delete(tabId);
      }
      HeaderInject.disable(tabId).catch((err) =>
        console.error("[NovaDebug] header inject disable 실패", err)
      );
    });
  });

  // Firefox 전용: devtools.network.onNavigated 발화가 문서 요청 완료보다 한참(관찰상 ~700ms)
  // 늦어 그 사이 이전 페이지 entry가 남는 문제 — 커밋 시점(webNavigation.onCommitted)을
  // devtools 포트로 릴레이해 더 이르게 정리할 수 있게 한다. Chrome 은 devtools onNavigated 가
  // 이미 커밋 시점이라 webNavigation 권한을 넣지 않으므로 ext.webNavigation 이 undefined —
  // 가드로 건너뛴다(동작 불변).
  if (ext.webNavigation) {
    ext.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId !== 0) return; // 메인 프레임만 — iframe 커밋은 무시
      const port = registeredPorts.get(details.tabId);
      if (!port) return;
      try {
        port.postMessage({ type: MSG.NAV_COMMITTED, url: details.url });
      } catch (err) {
        console.error("[NovaDebug] NAV_COMMITTED 릴레이 실패", err);
      }
    });
  }

  // 단축키(commands.toggle-site) — 현재 사이트의 hostMap[host].enabled 토글.
  // popup 의 사이트 스위치와 동일한 의미(저장 + 현재 탭 즉시 반영). 아이콘 상태는
  // icon-state.js 의 storage.onChanged 경로가 자동 갱신한다.
  function toggleSiteForTab(tab) {
    if (!tab || typeof tab.id !== "number") return;
    let host = null;
    try {
      const u = new URL(tab.url || "");
      if (/^https?:$/.test(u.protocol)) host = u.hostname;
    } catch {
      // http(s) 페이지가 아니면 무시
    }
    if (!host) return;

    loadHostMap(storageArea())
      .then((hostMap) => {
        const nextOn = !(hostMap[host] && hostMap[host].enabled);
        hostMap[host] = { ...(hostMap[host] || {}), enabled: nextOn };
        return storageArea()
          .set({ [STORAGE_KEYS.HOST_MAP]: hostMap })
          .then(() => {
            // Firefox MV3 host permission opt-in — 단축키도 user input 으로 인정되므로
            // 시도하되, 실패는 조용히 무시(popup 경로와 동일한 best-effort).
            if (nextOn && ext.permissions && typeof ext.permissions.request === "function") {
              ext.permissions.request({ origins: ["*://" + host + "/*"] }).catch(() => {});
            }
            // persist:true — SITE_TOGGLED 와 동일하게 devtools 재연결 경로가 없는 탭이라
            // SW 재시작 복원 대상으로 남긴다.
            return nextOn
              ? HeaderInject.enable(tab.id, { capture: true, persist: true })
              : HeaderInject.disable(tab.id);
          });
      })
      .catch((err) => {
        console.error("[NovaDebug] 단축키 사이트 토글 실패", err);
      });
  }

  if (ext.commands && ext.commands.onCommand) {
    ext.commands.onCommand.addListener((command, tab) => {
      if (command !== "toggle-site") return;
      // Chrome 은 두 번째 인자로 tab 을 주지만 Firefox 구버전은 없을 수 있어 폴백 조회
      if (tab && typeof tab.id === "number") {
        toggleSiteForTab(tab);
        return;
      }
      ext.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => toggleSiteForTab(tabs && tabs[0]))
        .catch((err) => console.error("[NovaDebug] 단축키 활성 탭 조회 실패", err));
    });
  }

  // popup 토글로 등록된 탭은 DevTools onDisconnect 경로를 타지 않으므로,
  // 탭이 닫힐 때 직접 정리한다.
  ext.tabs.onRemoved.addListener((tabId) => {
    HeaderInject.disable(tabId).catch((err) =>
      console.error("[NovaDebug] tab 종료 시 header inject disable 실패", err)
    );
  });

  // cleanupAll 이 지운 rule 중 popup/단축키 전용 탭(devtools 재연결 경로가 없음)은
  // restorePersistedTabs 가 storage.session 목록 기준으로 되살린다.
  HeaderInject.cleanupAll()
    .then(() => HeaderInject.restorePersistedTabs())
    .catch((err) => console.error("[NovaDebug] header inject cleanupAll 실패", err));
})(typeof self !== "undefined" ? self : this);
