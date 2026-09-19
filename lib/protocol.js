/*
 * Nova Debug — 프로토콜 상수
 *
 * service worker(Chrome)와 일반 페이지(devtools/panel, Firefox background)
 * 양쪽에서 <script>/importScripts 로 로드되므로 ES module 문법을 쓰지 않고
 * 전역(self)에 직접 부착한다.
 */
(function (root) {
  // 폴리필 다운로드 없이 크로스 브라우저 대응: 두 브라우저 모두 MV3 promise 기반 API 지원
  const ext = root.browser || (typeof chrome !== "undefined" ? chrome : undefined);

  // X-Nova-Debug-Fetch 응답 헤더 폐지(2026-07-12)에 따라 확장이 자체 설정으로 fetch 경로를
  // 구성한다. 호스트별 오버라이드(hostMap[hostname].fetchPath/token)가 없으면 기본 경로로 fallback한다.
  const DEFAULT_FETCH_PATH = "/common/debug/assets/log.php";

  const STORAGE_KEYS = {
    // 레거시(2026-07-12 hostMap 통합 이전) 키 — 마이그레이션 read-only, 더 이상 쓰지 않는다.
    IDE_MAP: "ideMap",
    ALLOW_LIST: "hostAllowList",
    HOST_MAP: "hostMap",
    TOKEN: "debugToken",
  };

  // value가 절대 URL(http/https)이면 그대로, 상대경로면 origin 기준으로 해석한다.
  // origin/value 조합이 잘못돼 파싱이 실패하면 null.
  function resolveUrl(origin, value) {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    try {
      return new URL(value, origin).href;
    } catch (err) {
      return null;
    }
  }

  // origin(스킴 포함 URL)에서 스킴·포트 없는 hostname만 추출. 파싱 실패 시 null.
  function extractHostname(origin) {
    if (!origin) return null;
    try {
      return new URL(origin).hostname || null;
    } catch (err) {
      return null;
    }
  }

  // 사용자가 입력한 임의 문자열(스킴 유무 불문, 예: "example.com", "https://example.com:8080")에서
  // hostname만 정규화해 추출한다. 실패 시 null.
  function normalizeHostname(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return null;
    const candidates = [trimmed, "https://" + trimmed];
    for (const candidate of candidates) {
      try {
        const hostname = new URL(candidate).hostname;
        if (hostname) return hostname.toLowerCase();
      } catch (err) {
        // 다음 후보 시도
      }
    }
    return null;
  }

  // ------------------------------------------------------------
  // hostMap 키 패턴 (2.1.1+)
  //  - 정확한 hostname: "example.com"
  //  - 와일드카드: "*.example.com" (선행 "*." 는 match pattern 관례대로 example.com 자신 +
  //    모든 깊이의 서브도메인), 그 외 위치의 "*" 는 라벨 내 임의 문자열([^.]*)
  //  - 정규식: "/^dev\\d+\\.example\\.com$/" — 슬래시로 감싼 hostname 전체 매칭(대소문자 무시)
  // ------------------------------------------------------------

  function isRegexHostKey(key) {
    return typeof key === "string" && key.length > 2 && key[0] === "/" && key.endsWith("/");
  }

  function isPatternHostKey(key) {
    return isRegexHostKey(key) || (typeof key === "string" && key.includes("*"));
  }

  function escapeRegexLiteral(s) {
    return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }

  // 패턴 키 → hostname 전체에 매칭할 정규식 source(앵커 없음). 패턴 키가 아니거나
  // 정규식이 잘못됐으면 null. 정규식 키는 사용자가 넣은 ^/$ 앵커를 벗겨 호출측이
  // hostname 전체 매칭(^...$) 또는 URL 삽입(DNR regexFilter) 양쪽에 쓸 수 있게 한다.
  function hostKeyRegexSource(key) {
    if (isRegexHostKey(key)) {
      let body = key.slice(1, -1);
      body = body.replace(/^\^/, "").replace(/([^\\])\$$/, "$1").replace(/^\$$/, "");
      try {
        new RegExp(body);
      } catch (err) {
        return null;
      }
      return "(?:" + body + ")";
    }
    if (typeof key === "string" && key.includes("*")) {
      let rest = key;
      let prefix = "";
      if (rest.startsWith("*.")) {
        prefix = "(?:[^.]+\\.)*";
        rest = rest.slice(2);
      }
      const body = rest.split("*").map(escapeRegexLiteral).join("[^.]*");
      return prefix + body;
    }
    return null;
  }

  function hostKeyToRegExp(key) {
    const source = hostKeyRegexSource(key);
    if (!source) return null;
    try {
      return new RegExp("^(?:" + source + ")$", "i");
    } catch (err) {
      return null;
    }
  }

  // host 에 해당하는 hostMap 항목 조회 — 정확 일치가 항상 우선하고, 없으면 패턴 키
  // (와일드카드/정규식)를 정의 순서대로 검사해 첫 매칭을 반환. 반환: { key, entry } | null.
  function findHostEntry(host, hostMap) {
    if (!host || !hostMap) return null;
    if (Object.prototype.hasOwnProperty.call(hostMap, host)) {
      return { key: host, entry: hostMap[host] };
    }
    for (const key of Object.keys(hostMap)) {
      if (!isPatternHostKey(key)) continue;
      const re = hostKeyToRegExp(key);
      if (re && re.test(host)) return { key, entry: hostMap[key] };
    }
    return null;
  }

  // 옵션/설정 입력값 → hostMap 키 정규화. 일반 hostname 은 normalizeHostname 과 동일,
  // 와일드카드/정규식 패턴은 형식 검증 후 그대로(소문자화) 통과. 실패 시 null.
  function normalizeHostKey(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return null;
    if (isRegexHostKey(trimmed)) {
      return hostKeyRegexSource(trimmed) ? trimmed : null;
    }
    if (trimmed.includes("*")) {
      const lowered = trimmed.toLowerCase();
      // "_" 포함 — 공인 도메인에는 못 쓰지만 로컬 개발 호스트명에는 흔하고, 정확 hostname
      // 경로(normalizeHostname → URL 파서)가 이미 허용하므로 와일드카드도 같게 맞춘다.
      if (!/^[a-z0-9._*-]+$/.test(lowered)) return null;
      if (lowered.includes("..") || lowered.startsWith(".") || lowered.endsWith(".")) return null;
      if (lowered.replace(/[._*-]/g, "") === "") return null; // "*", "*.*" 등 전체 허용 패턴 금지
      return lowered;
    }
    return normalizeHostname(trimmed);
  }

  // hostname 기준 token 오버라이드(hostMap 매칭 항목의 token) → 전역 token → "1"(하위호환: 서버
  // ext.tokens 미설정 상태와 동일하게 값 존재 여부만으로 협상되는 opt-in 신호).
  function tokenForHost(host, config) {
    const found = findHostEntry(host, config && config.hostMap);
    const entry = (found && found.entry) || {};
    const override = (entry.token || "").trim();
    const globalToken = ((config && config.token) || "").trim();
    return override || globalToken || "1";
  }

  // config: { hostMap, token(전역) } — storage.get 결과를 그대로 넘기면 된다.
  // hostname별 오버라이드(hostMap 매칭 항목의 fetchPath) → DEFAULT_FETCH_PATH 순.
  function effectiveFetchPath(origin, config) {
    const host = extractHostname(origin);
    const found = findHostEntry(host, config && config.hostMap);
    const entry = (found && found.entry) || {};
    const override = (entry.fetchPath || "").trim();
    return resolveUrl(origin, override || DEFAULT_FETCH_PATH);
  }

  function effectiveToken(origin, config) {
    return tokenForHost(extractHostname(origin), config);
  }

  // 구모델(hostAllowList + ideMap) → hostMap 1회 변환. 순수 함수(스토리지 I/O 없음).
  // - hostAllowList 의 origin → hostname: enabled=true
  // - ideMap 에만 있던 origin → hostname: enabled=false(허용 목록에 없었으므로), 설정 필드 이전
  // - 같은 hostname 충돌(http/https 등 중복) 시: enabled는 OR(먼저 true가 되면 유지),
  //   설정 필드는 값이 있는 쪽 우선(먼저 채워진 값 유지)
  function migrateToHostMap(hostAllowList, ideMap) {
    const hostMap = {};
    (hostAllowList || []).forEach((origin) => {
      const host = extractHostname(origin);
      if (!host) return;
      if (!hostMap[host]) hostMap[host] = {};
      hostMap[host].enabled = true;
    });
    Object.keys(ideMap || {}).forEach((origin) => {
      const host = extractHostname(origin);
      if (!host) return;
      const cfg = ideMap[origin] || {};
      if (!hostMap[host]) hostMap[host] = {};
      if (hostMap[host].enabled === undefined) hostMap[host].enabled = false;
      ["protocol", "localPath", "project", "fetchPath", "token"].forEach((field) => {
        if (cfg[field] && !hostMap[host][field]) hostMap[host][field] = cfg[field];
      });
    });
    return hostMap;
  }

  // hostMap 로드 — 저장된 값이 없으면(최초 1회) 레거시 키에서 마이그레이션해 저장까지 수행한다.
  // area: ext.storage.sync || ext.storage.local
  function loadHostMap(area) {
    return area
      .get([STORAGE_KEYS.HOST_MAP, STORAGE_KEYS.ALLOW_LIST, STORAGE_KEYS.IDE_MAP])
      .then((res) => {
        const existing = res && res[STORAGE_KEYS.HOST_MAP];
        if (existing) return existing;
        const migrated = migrateToHostMap(
          (res && res[STORAGE_KEYS.ALLOW_LIST]) || [],
          (res && res[STORAGE_KEYS.IDE_MAP]) || {}
        );
        return area.set({ [STORAGE_KEYS.HOST_MAP]: migrated }).then(() => migrated);
      });
  }

  function isInsecureUrl(url) {
    return typeof url === "string" && /^http:\/\//i.test(url);
  }

  // 서버 ext.tokens 협상용 토큰 생성 (32자리 hex). options/popup 양쪽에서 공용으로 사용.
  function generateToken() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  root.NovaDebugProtocol = {
    ext,

    // 요청 헤더 (확장 → 서버)
    REQUEST_HEADER: "X-Nova-Debug",

    // 응답 헤더 (서버 → 확장)
    ID_HEADER: "X-Nova-Debug-Id",

    // devtools panel ↔ background 포트
    PORT_NAME: "nova-debug",

    MSG: {
      REGISTER: "register",
      PANEL_SHOWN: "panel-shown",
      PANEL_HIDDEN: "panel-hidden",
      FETCH: "fetch",
      PING: "ping",
      PONG: "pong",
      SITE_TOGGLED: "site-toggled",
      OPEN_OPTIONS: "open-options",
      NAV_COMMITTED: "nav-committed",
    },

    STORAGE_KEYS,
    DEFAULT_FETCH_PATH,
    resolveUrl,
    extractHostname,
    normalizeHostname,
    normalizeHostKey,
    isRegexHostKey,
    isPatternHostKey,
    hostKeyRegexSource,
    hostKeyToRegExp,
    findHostEntry,
    tokenForHost,
    effectiveFetchPath,
    effectiveToken,
    migrateToHostMap,
    loadHostMap,
    isInsecureUrl,
    generateToken,
  };
})(typeof self !== "undefined" ? self : this);
