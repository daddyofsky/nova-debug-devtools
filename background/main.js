/*
 * Nova Debug — background 엔트리
 *
 * Chrome: manifest 의 service_worker 로 이 파일 하나만 지정 → importScripts 로 나머지 로드
 * Firefox: manifest 의 background.scripts 배열이 protocol.js/header-inject.js 를
 *          이 파일보다 먼저 로드하므로 importScripts 는 건너뛴다 (service worker 전용 함수)
 */
if (typeof importScripts === "function") {
  importScripts("../lib/protocol.js", "./header-inject.js");
}

(function (root) {
  const ext = root.NovaDebugProtocol.ext;
  const PORT_NAME = root.NovaDebugProtocol.PORT_NAME;
  const MSG = root.NovaDebugProtocol.MSG;
  const REQUEST_HEADER = root.NovaDebugProtocol.REQUEST_HEADER;
  const HeaderInject = root.NovaHeaderInject;

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

    // popup 의 사이트 on/off 는 DevTools 로 등록된 탭(activeTabIds)에만 반영되는
    // storage.onChanged 경로를 안 타므로, 등록 여부와 무관하게 현재 탭에 바로 적용되도록
    // popup 이 직접 이 메시지를 보낸다.
    if (msg.type === MSG.SITE_TOGGLED) {
      const action = msg.enabled ? HeaderInject.enable(msg.tabId) : HeaderInject.disable(msg.tabId);
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

  ext.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    let tabId = null;

    port.onMessage.addListener((msg) => {
      if (!msg) return;

      if (msg.type === MSG.REGISTER) {
        tabId = msg.tabId;
        registeredPorts.set(tabId, port);
        HeaderInject.enable(tabId).catch((err) =>
          console.error("[NovaDebug] header inject enable 실패", err)
        );
        return;
      }

      // devtools.js 의 heartbeat — 응답만으로 이 이벤트가 idle 타이머를 리셋시키고,
      // devtools 쪽은 응답 유무로 port 가 살아있는 background 에 실제로 닿아있는지 확인한다.
      if (msg.type === MSG.PING) {
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
      if (registeredPorts.get(tabId) === port) registeredPorts.delete(tabId);
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

  // popup 토글로 등록된 탭은 DevTools onDisconnect 경로를 타지 않으므로,
  // 탭이 닫힐 때 직접 정리한다.
  ext.tabs.onRemoved.addListener((tabId) => {
    HeaderInject.disable(tabId).catch((err) =>
      console.error("[NovaDebug] tab 종료 시 header inject disable 실패", err)
    );
  });

  HeaderInject.cleanupAll().catch((err) =>
    console.error("[NovaDebug] header inject cleanupAll 실패", err)
  );
})(typeof self !== "undefined" ? self : this);
