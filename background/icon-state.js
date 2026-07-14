/*
 * Nova Debug — 툴바 아이콘 상태 반영
 *
 * 사이트별 설정(hostMap[host].enabled)이 켜진 탭은 기본(진한) 아이콘,
 * 꺼져 있거나 지원하지 않는 페이지는 흐린 아이콘(icons/icon*-off.png)을 표시한다.
 * manifest 의 action.default_icon 은 흐린 아이콘 — 탭별 setIcon 으로 켜진 탭만 승격한다.
 */
(function (root) {
  const ext = root.NovaDebugProtocol.ext;
  const STORAGE_KEYS = root.NovaDebugProtocol.STORAGE_KEYS;
  const extractHostname = root.NovaDebugProtocol.extractHostname;
  const loadHostMap = root.NovaDebugProtocol.loadHostMap;

  const ICON_ON = {
    16: "/icons/icon16.png",
    32: "/icons/icon32.png",
    48: "/icons/icon48.png",
    128: "/icons/icon128.png",
  };
  const ICON_OFF = {
    16: "/icons/icon16-off.png",
    32: "/icons/icon32-off.png",
    48: "/icons/icon48-off.png",
    128: "/icons/icon128-off.png",
  };

  function storageArea() {
    return ext.storage.sync || ext.storage.local;
  }

  function setTabIcon(tabId, url, hostMap) {
    const host = extractHostname(url);
    const entry = host ? hostMap[host] : null;
    const enabled = !!(entry && entry.enabled);
    // 탭이 이미 닫혔거나 접근 불가한 탭이면 실패 — 무시
    return ext.action.setIcon({ tabId, path: enabled ? ICON_ON : ICON_OFF }).catch(() => {});
  }

  function refreshAllTabs() {
    return Promise.all([loadHostMap(storageArea()), ext.tabs.query({})])
      .then(([hostMap, tabs]) =>
        Promise.all(tabs.map((tab) => setTabIcon(tab.id, tab.url || "", hostMap)))
      )
      .catch((err) => console.error("[NovaDebug] 아이콘 상태 갱신 실패", err));
  }

  // 내비게이션 시 브라우저가 탭별 아이콘을 default_icon 으로 리셋하므로 매 로드마다 다시 계산한다.
  ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "loading" && !changeInfo.url) return;
    loadHostMap(storageArea())
      .then((hostMap) => setTabIcon(tabId, (tab && tab.url) || changeInfo.url || "", hostMap))
      .catch((err) => console.error("[NovaDebug] 아이콘 갱신 실패", err));
  });

  // popup/옵션에서 사이트 on/off 저장 → 열린 탭 전체에 즉시 반영
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" && area !== "local") return;
    if (!changes[STORAGE_KEYS.HOST_MAP]) return;
    refreshAllTabs();
  });

  // 워커/브라우저 기동 시 현재 열려 있는 탭들 반영
  refreshAllTabs();
})(typeof self !== "undefined" ? self : this);
