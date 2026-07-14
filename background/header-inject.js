/*
 * Nova Debug — 요청 헤더 주입
 *
 * background/main.js 에 enable(tabId)/disable(tabId) 만 노출한다.
 * Chrome: declarativeNetRequest session rule (탭 한정)
 * Firefox: DNR session rule의 tabIds 조건 미지원 이슈로 webRequest.onBeforeSendHeaders(blocking) 사용
 * 두 구현 중 무엇을 쓸지는 브라우저 종류가 아니라 API 존재 여부로 판단한다.
 */
(function (root) {
  const ext = root.NovaDebugProtocol.ext;
  const REQUEST_HEADER = root.NovaDebugProtocol.REQUEST_HEADER;
  const REQUEST_HEADER_LC = REQUEST_HEADER.toLowerCase();
  const STORAGE_KEYS = root.NovaDebugProtocol.STORAGE_KEYS;
  const tokenForHost = root.NovaDebugProtocol.tokenForHost;
  const loadHostMap = root.NovaDebugProtocol.loadHostMap;

  // rule id는 탭 산술로 만들지 않는다 — 실 브라우저 tabId는 int32 상한을 넘는 값이 흔해
  // (base + tabId*블록크기 계산이 declarativeNetRequest 의 정수 id 범위를 벗어나 rule 등록이 통째로 거부됨).
  // 대신 고정 풀([BASE..MAX]) 안에서 빈 id를 순차 할당하고, rule 소속은 id가 아니라
  // condition.tabIds(우리 rule은 항상 [tabId] 단일)로 판별한다.
  const DNR_RULE_ID_BASE = 10000;
  const DNR_RULE_ID_MAX = DNR_RULE_ID_BASE + 999; // 전체 탭이 공유하는 rule id 풀 상한
  const RESOURCE_TYPES = ["main_frame", "sub_frame", "xmlhttprequest"];

  function hasDeclarativeNetRequest() {
    return !!(
      ext.declarativeNetRequest &&
      typeof ext.declarativeNetRequest.updateSessionRules === "function"
    );
  }

  function ruleBelongsToTab(rule, tabId) {
    return (
      rule.id >= DNR_RULE_ID_BASE &&
      rule.id <= DNR_RULE_ID_MAX &&
      rule.condition &&
      Array.isArray(rule.condition.tabIds) &&
      rule.condition.tabIds.includes(tabId)
    );
  }

  function storageArea() {
    return ext.storage.sync || ext.storage.local;
  }

  // hostMap(호스트별 enabled/토큰 오버라이드 조회용) + 전역 토큰 — tokenForHost() 계산에
  // 필요한 설정 묶음. hostMap 이 아직 없으면(최초 1회) 여기서 레거시 키로부터 마이그레이션된다.
  function loadHostConfig() {
    return Promise.all([loadHostMap(storageArea()), storageArea().get(STORAGE_KEYS.TOKEN)])
      .then(([hostMap, tokenRes]) => ({
        hostMap,
        token: (tokenRes && tokenRes[STORAGE_KEYS.TOKEN]) || "",
      }))
      .catch((err) => {
        console.error("[NovaDebug] 호스트 설정 로드 실패", err);
        return { hostMap: {}, token: "" };
      });
  }

  // 활성 tab 추적 — DNR/webRequest 경로 공통. storage 변경 시 이 tabId 들의 rule/캐시를 재구성한다.
  // capture=false: DevTools 오픈(REGISTER) 단계 — captureOnOpen 호스트에만 주입
  // capture=true : 패널 첫 표시(PANEL_SHOWN) 또는 popup 명시 토글 — enabled 호스트 전부 주입
  const activeTabs = new Map(); // tabId -> { capture }

  function tabCaptures(tabId) {
    const state = activeTabs.get(tabId);
    return !!(state && state.capture);
  }

  // 탭에서 헤더를 주입할 호스트인지 — enabled 이면서, 탭이 캡쳐 승격됐거나 호스트가
  // DevTools 오픈 즉시 캡쳐(captureOnOpen)로 설정된 경우.
  function hostInjectable(entry, capture) {
    return !!(entry && entry.enabled && (capture || entry.captureOnOpen));
  }

  async function enableViaDnr(tabId) {
    const [hostConfig, existingRules] = await Promise.all([
      loadHostConfig(),
      ext.declarativeNetRequest.getSessionRules(),
    ]);
    const capture = tabCaptures(tabId);

    // 토큰 값이 같은 host끼리 그룹화해 그룹당 rule 1개만 생성 (대부분 전역 토큰 하나뿐이라
    // 사실상 기존처럼 탭당 rule 1개로 유지된다).
    const groups = new Map(); // token -> hostnames[]
    Object.keys(hostConfig.hostMap).forEach((host) => {
      const entry = hostConfig.hostMap[host];
      if (!hostInjectable(entry, capture)) return;
      const token = tokenForHost(host, hostConfig);
      if (!groups.has(token)) groups.set(token, []);
      groups.get(token).push(host);
    });

    const removeRuleIds = existingRules
      .filter((rule) => ruleBelongsToTab(rule, tabId))
      .map((rule) => rule.id);
    const removeSet = new Set(removeRuleIds);
    // 재등록(같은 탭 enable 재호출) 시 이번에 지울 rule id는 곧바로 재사용 가능하도록 occupied에서 뺀다.
    const occupiedIds = new Set(
      existingRules
        .map((rule) => rule.id)
        .filter((id) => id >= DNR_RULE_ID_BASE && id <= DNR_RULE_ID_MAX && !removeSet.has(id))
    );

    const addRules = [];
    let candidateId = DNR_RULE_ID_BASE;
    for (const [token, hosts] of groups) {
      while (occupiedIds.has(candidateId)) candidateId++;
      if (candidateId > DNR_RULE_ID_MAX) {
        console.error(
          "[NovaDebug] rule id 풀(" + (DNR_RULE_ID_MAX - DNR_RULE_ID_BASE + 1) + "개)을 초과해 일부 origin에 헤더가 주입되지 않습니다",
          tabId
        );
        break;
      }
      addRules.push({
        id: candidateId,
        priority: 1,
        condition: {
          tabIds: [tabId],
          resourceTypes: RESOURCE_TYPES,
          requestDomains: hosts,
        },
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: REQUEST_HEADER, operation: "set", value: token }],
        },
      });
      occupiedIds.add(candidateId);
      candidateId++;
    }

    // opt-in 방식 — enabled 항목이 없으면(groups 도 비어짐) addRules=[] 로 어디에도 주입하지 않는다.
    await ext.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
  }

  async function disableViaDnr(tabId) {
    const rules = await ext.declarativeNetRequest.getSessionRules();
    const removeRuleIds = rules.filter((rule) => ruleBelongsToTab(rule, tabId)).map((rule) => rule.id);
    if (removeRuleIds.length === 0) return;
    await ext.declarativeNetRequest.updateSessionRules({ removeRuleIds });
  }

  // webRequest 폴백 (Firefox)
  let listenerRegistered = false;
  let hostConfigCache = { hostMap: {}, token: "" };

  function refreshCaches() {
    return loadHostConfig().then((hostConfig) => {
      hostConfigCache = hostConfig;
    });
  }

  function onBeforeSendHeaders(details) {
    if (!activeTabs.has(details.tabId)) return {};
    let host;
    try {
      host = new URL(details.url).hostname;
    } catch {
      return {};
    }
    const entry = hostConfigCache.hostMap[host];
    if (!hostInjectable(entry, tabCaptures(details.tabId))) return {};
    const token = tokenForHost(host, hostConfigCache);
    const headers = details.requestHeaders || [];
    const existing = headers.find((h) => h.name && h.name.toLowerCase() === REQUEST_HEADER_LC);
    if (existing) {
      existing.value = token;
    } else {
      headers.push({ name: REQUEST_HEADER, value: token });
    }
    return { requestHeaders: headers };
  }

  function ensureListener() {
    if (listenerRegistered) return;
    listenerRegistered = true;
    ext.webRequest.onBeforeSendHeaders.addListener(
      onBeforeSendHeaders,
      { urls: ["<all_urls>"], types: RESOURCE_TYPES },
      ["blocking", "requestHeaders"]
    );
  }

  // opts.capture: true=승격 / false=명시 리셋 / undefined=기존 상태 유지.
  // REGISTER 는 false 리셋을 쓴다 — Firefox 에서 DevTools 닫힘의 onDisconnect 가 누락되면
  // 이전 세션의 승격(capture=true)이 event page 메모리에 남아, 재오픈 시 체크박스와 무관하게
  // 전체 주입되는 문제가 있었다. 재시작/재연결 시 패널이 이미 표시된 상태였다면 devtools.js 가
  // PANEL_SHOWN 을 재전송하므로 리셋해도 승격이 곧바로 복원된다.
  async function enable(tabId, opts) {
    const prev = tabCaptures(tabId);
    const capture = (opts && typeof opts.capture === "boolean") ? opts.capture : prev;
    activeTabs.set(tabId, { capture });
    if (hasDeclarativeNetRequest()) {
      await enableViaDnr(tabId);
    } else {
      await refreshCaches();
      ensureListener();
    }
  }

  async function disable(tabId) {
    activeTabs.delete(tabId);
    if (hasDeclarativeNetRequest()) {
      await disableViaDnr(tabId);
    }
  }

  // 옵션/팝업에서 hostMap·전역 토큰 저장 시 활성 tab 들의 rule/캐시를 재구성한다.
  if (ext.storage && ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      const relevant = changes[STORAGE_KEYS.HOST_MAP] || changes[STORAGE_KEYS.TOKEN];
      if (!relevant) return;
      if (hasDeclarativeNetRequest()) {
        activeTabs.forEach((state, tabId) => {
          enableViaDnr(tabId).catch((err) =>
            console.error("[NovaDebug] 호스트/토큰 변경 반영 실패", err)
          );
        });
      } else {
        refreshCaches();
      }
    });
  }

  // 서비스워커 재시작 시 이전에 등록된 rule 잔존분 정리 (열려 있는 패널은
  // onDisconnect → 재연결 → 재 REGISTER 로 다시 등록하므로 안전).
  async function cleanupAll() {
    if (!hasDeclarativeNetRequest()) return; // webRequest 경로는 메모리 상태라 재시작 시 자동 소멸
    const rules = await ext.declarativeNetRequest.getSessionRules();
    const ourRuleIds = rules
      .map((rule) => rule.id)
      .filter((id) => id >= DNR_RULE_ID_BASE);
    if (ourRuleIds.length === 0) return;
    await ext.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ourRuleIds,
    });
  }

  root.NovaHeaderInject = { enable, disable, cleanupAll };
})(typeof self !== "undefined" ? self : this);
