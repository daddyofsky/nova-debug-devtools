/*
 * devtools/devtools.js 내비게이션 정리 로직 회귀 테스트
 *
 * 실행: node test/nav-clear.test.js
 * 브라우저 없이 devtools_page 스크립트를 vm 샌드박스에 로드하고 devtools API 를 흉내 내
 * 내비게이션 이벤트 순서에 따른 entries 정리 결과를 검증한다.
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const protocolSrc = fs.readFileSync(path.join(ROOT, "lib/protocol.js"), "utf8");
const devtoolsSrc = fs.readFileSync(path.join(ROOT, "devtools/devtools.js"), "utf8");

function makeEnv({ firefox }) {
  const state = {
    timeOrigin: 1000,
    onRequestFinished: null,
    onNavigated: null,
    portMessage: null,
    shared: null,
  };

  const listenerSlot = (name) => ({
    addListener(fn) { state[name] = fn; },
  });

  const promise = (v) => Promise.resolve(v);

  const chromeStub = {
    storage: {
      local: {
        get: () => promise({}),
        set: () => promise(undefined),
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      connect: () => ({
        postMessage() {},
        disconnect() {},
        onMessage: { addListener(fn) { state.portMessage = fn; } },
        onDisconnect: { addListener() {} },
      }),
      sendMessage: () => promise({ ok: true, data: { schemaVersion: 2, entries: [], summary: {} } }),
    },
    devtools: {
      inspectedWindow: {
        tabId: 1,
        eval(expr, cb) {
          const value = expr === "performance.timeOrigin" ? state.timeOrigin : "http://t.local/";
          if (firefox) return promise([value, null]);
          cb(value);
        },
      },
      network: {
        onRequestFinished: listenerSlot("onRequestFinished"),
        onNavigated: listenerSlot("onNavigated"),
      },
      panels: {
        themeName: "light",
        create(_n, _i, _p, cb) {
          cb({
            onShown: { addListener(fn) { state.panelShown = fn; } },
            onHidden: { addListener() {} },
          });
        },
      },
    },
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, Date, Promise, Set, WeakSet, Map,
    chrome: chromeStub,
  };
  if (firefox) sandbox.browser = chromeStub;
  sandbox.self = sandbox;
  sandbox.window = sandbox;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(protocolSrc, ctx);
  vm.runInContext(devtoolsSrc, ctx);

  // 패널 표시 → shared 주입
  const win = {};
  state.panelShown(win);
  state.shared = win.__novaAttach ? null : null;
  win.__novaAttach = null;
  // __novaAttach 는 panel.js 가 정의하므로 직접 가로챈다
  return { state, ctx, sandbox };
}

// panel.js 없이 shared 를 얻기 위해, __novaAttach 가 정의된 win 으로 다시 onShown 호출
function attachShared(state) {
  let shared = null;
  const win = { __novaAttach: (s) => { shared = s; } };
  state.panelShown(win);
  return shared;
}

let idSeq = 0;
function request(url, method = "GET") {
  return {
    request: { url, method },
    response: { status: 200, headers: [{ name: "X-Nova-Debug-Id", value: "id" + ++idSeq }] },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log("  PASS  " + name); return; }
  failures++;
  console.log("  FAIL  " + name + (detail ? "\n        " + detail : ""));
}
const urls = (shared) => shared.entries.map((e) => e.method + " " + e.url).join(", ");

async function scenarioFirefoxSameUrlAjax() {
  console.log("\n[Firefox] 페이지와 같은 URL 로 ajax POST 가 있는 내비게이션");
  const { state } = makeEnv({ firefox: true });
  const shared = attachShared(state);
  const MSG_NAV = "nav-committed";

  // 이전 페이지 entry
  state.onRequestFinished(request("http://t.local/old"));
  await tick();

  // 커밋 릴레이 → 이전 페이지 정리
  state.timeOrigin = 2000;
  state.portMessage({ type: MSG_NAV, url: "http://t.local/foo" });
  await tick();
  check("커밋 시점에 이전 페이지 entry 제거", shared.entries.length === 0, urls(shared));

  // 새 페이지 문서 + 같은 URL ajax POST
  state.onRequestFinished(request("http://t.local/foo"));
  await tick();
  state.onRequestFinished(request("http://t.local/foo", "POST"));
  await tick();

  // ~700ms 뒤 devtools onNavigated
  state.onNavigated("http://t.local/foo");
  await tick(); await tick();

  check("문서 entry 가 남아 있음", shared.entries.length === 2, urls(shared));
  check("첫 entry 가 문서(GET)", shared.entries[0] && shared.entries[0].method === "GET", urls(shared));
}

async function scenarioChromeNavigation() {
  console.log("\n[Chrome] 일반 내비게이션 (NAV_COMMITTED 없음)");
  const { state } = makeEnv({ firefox: false });
  const shared = attachShared(state);

  state.onRequestFinished(request("http://t.local/old"));
  state.onRequestFinished(request("http://t.local/old-ajax"));
  await tick();
  check("이전 페이지 entry 2건", shared.entries.length === 2, urls(shared));

  state.timeOrigin = 2000; // 문서 교체
  state.onNavigated("http://t.local/bar");
  await tick(); await tick();
  check("내비게이션 시 이전 entry 제거", shared.entries.length === 0, urls(shared));

  state.onRequestFinished(request("http://t.local/bar"));
  await tick();
  state.onRequestFinished(request("http://t.local/bar", "POST"));
  await tick();
  check("새 페이지 문서 + 같은 URL ajax 유지", shared.entries.length === 2, urls(shared));
}

async function scenarioPushState() {
  console.log("\n[공통] same-document 이동(pushState) 은 목록을 비우지 않음");
  const { state } = makeEnv({ firefox: false });
  const shared = attachShared(state);

  state.timeOrigin = 2000;
  state.onNavigated("http://t.local/list");
  await tick(); await tick();
  state.onRequestFinished(request("http://t.local/list"));
  await tick();
  state.onRequestFinished(request("http://t.local/api/rows"));
  await tick();
  check("페이지 로드 후 2건", shared.entries.length === 2, urls(shared));

  // pushState — 문서 교체 없음(timeOrigin 유지)
  state.onNavigated("http://t.local/list/page/2");
  await tick(); await tick();
  check("pushState 후에도 기존 로그 유지", shared.entries.length === 2, urls(shared));
}

async function scenarioReload() {
  console.log("\n[Firefox] 같은 URL 재로드 시 이전 로드분 제거");
  const { state } = makeEnv({ firefox: true });
  const shared = attachShared(state);

  state.timeOrigin = 2000;
  state.portMessage({ type: "nav-committed", url: "http://t.local/foo" });
  await tick();
  state.onRequestFinished(request("http://t.local/foo"));
  await tick();
  state.onRequestFinished(request("http://t.local/api"));
  await tick();
  state.onNavigated("http://t.local/foo");
  await tick(); await tick();
  check("1차 로드 2건", shared.entries.length === 2, urls(shared));
  const firstDoc = shared.entries[0];

  // 곧바로 reload (1.5s 이내)
  state.timeOrigin = 3000;
  state.portMessage({ type: "nav-committed", url: "http://t.local/foo" });
  await tick();
  check("재로드 커밋 시 이전 로드분 전부 제거", shared.entries.length === 0, urls(shared));

  state.onRequestFinished(request("http://t.local/foo"));
  await tick();
  state.onNavigated("http://t.local/foo");
  await tick(); await tick();
  check("2차 로드 문서만 유지", shared.entries.length === 1 && shared.entries[0] !== firstDoc, urls(shared));
}


async function scenarioDocBeforeEval() {
  console.log("\n[Chrome] 문서 entry 가 내비게이션 처리보다 먼저 도착한 경우");
  const { state } = makeEnv({ firefox: false });
  const shared = attachShared(state);

  state.onRequestFinished(request("http://t.local/old"));
  await tick();

  // onNavigated 직후(timeOrigin 확인 전)에 문서 entry 가 붙는 순서
  state.timeOrigin = 2000;
  state.onNavigated("http://t.local/bar");
  state.onRequestFinished(request("http://t.local/bar"));
  await tick(); await tick(); await tick();

  check("문서 entry 만 남음", shared.entries.length === 1, urls(shared));
  check("남은 것이 새 페이지 문서", shared.entries[0] && shared.entries[0].url.endsWith("/bar"), urls(shared));
}

async function scenarioPreserveLog() {
  console.log("\n[공통] preserve log 켜면 내비게이션에도 목록 유지");
  const { state } = makeEnv({ firefox: false });
  const shared = attachShared(state);

  state.onRequestFinished(request("http://t.local/a"));
  await tick();
  shared.setPreserveLog(true);

  state.timeOrigin = 2000;
  state.onNavigated("http://t.local/b");
  await tick(); await tick();
  check("preserve 중 목록 유지", shared.entries.length === 1, urls(shared));

  shared.setPreserveLog(false);
  state.timeOrigin = 3000;
  state.onNavigated("http://t.local/c");
  await tick(); await tick();
  check("preserve 해제 후 다음 내비게이션에서 정리", shared.entries.length === 0, urls(shared));
}

(async () => {
  await scenarioFirefoxSameUrlAjax();
  await scenarioChromeNavigation();
  await scenarioPushState();
  await scenarioReload();
  await scenarioDocBeforeEval();
  await scenarioPreserveLog();
  console.log(failures ? "\n실패 " + failures + "건" : "\n전체 통과");
  process.exit(failures ? 1 : 0);
})();
