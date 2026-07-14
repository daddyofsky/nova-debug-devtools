/* Nova Debug — 팝업 (활성 탭 origin 표시, 사이트 on/off, IDE 매핑 간이 편집) */
(function () {
  const ext = NovaDebugProtocol.ext;

  const PROTOCOLS = ["phpstorm", "idea", "vscode"];
  const CUSTOM_PROTOCOL_VALUE = "__custom__";
  const STORAGE_KEYS = NovaDebugProtocol.STORAGE_KEYS;

  const unsupportedMsgEl = document.getElementById("unsupported-msg");
  const siteSectionEl = document.getElementById("site-section");
  const siteOriginEl = document.getElementById("site-origin");
  const siteToggleBtn = document.getElementById("site-toggle");
  const protocolSelect = document.getElementById("ide-protocol");
  const protocolCustomInput = document.getElementById("ide-protocol-custom");
  const localPathInput = document.getElementById("ide-localpath");
  const projectInput = document.getElementById("ide-project");
  const fetchPathInput = document.getElementById("ide-fetchpath");
  const fetchPathWarnEl = document.getElementById("site-origin-warn");
  const tokenInput = document.getElementById("ide-token");
  const genTokenBtn = document.getElementById("btn-gen-ide-token");
  const copyTokenBtn = document.getElementById("btn-copy-ide-token");
  const tokenStatusEl = document.getElementById("ide-token-status");
  const saveIdeBtn = document.getElementById("btn-save-ide");
  const ideSaveStatusEl = document.getElementById("ide-save-status");
  const openOptionsBtn = document.getElementById("btn-open-options");
  const siteToggleHintEl = document.getElementById("site-toggle-hint");

  projectInput.placeholder = "(선택)";
  fetchPathInput.placeholder = "(기본값: " + NovaDebugProtocol.DEFAULT_FETCH_PATH + ")";
  tokenInput.placeholder = "(전역 사용)";

  let origin = null;
  let host = null;
  let tabId = null;
  let toggleHintTimer = null;

  function storageArea() {
    return ext.storage.sync || ext.storage.local;
  }

  PROTOCOLS.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    protocolSelect.appendChild(opt);
  });
  const customOpt = document.createElement("option");
  customOpt.value = CUSTOM_PROTOCOL_VALUE;
  customOpt.textContent = "직접입력";
  protocolSelect.appendChild(customOpt);

  protocolSelect.addEventListener("change", () => {
    const isCustom = protocolSelect.value === CUSTOM_PROTOCOL_VALUE;
    protocolCustomInput.classList.toggle("hidden", !isCustom);
    if (isCustom) protocolCustomInput.focus();
  });

  function applyProtocolValue(protocol) {
    if (protocol && !PROTOCOLS.includes(protocol)) {
      protocolSelect.value = CUSTOM_PROTOCOL_VALUE;
      protocolCustomInput.value = protocol;
      protocolCustomInput.classList.remove("hidden");
    } else {
      protocolSelect.value = protocol || "phpstorm";
      protocolCustomInput.value = "";
      protocolCustomInput.classList.add("hidden");
    }
  }

  function showUnsupported(text) {
    unsupportedMsgEl.textContent = text;
    unsupportedMsgEl.classList.remove("hidden");
    siteSectionEl.classList.add("hidden");
  }

  function setSwitchState(on) {
    siteToggleBtn.setAttribute("aria-checked", on ? "true" : "false");
  }

  function updateFetchPathWarning() {
    const config = { hostMap: { [host]: { fetchPath: fetchPathInput.value } } };
    const effective = NovaDebugProtocol.effectiveFetchPath(origin, config);
    fetchPathWarnEl.classList.toggle("hidden", !NovaDebugProtocol.isInsecureUrl(effective));
  }

  fetchPathInput.addEventListener("input", updateFetchPathWarning);

  function loadSiteState() {
    NovaDebugProtocol.loadHostMap(storageArea())
      .then((hostMap) => {
        const config = hostMap[host] || {};
        setSwitchState(!!config.enabled);
        applyProtocolValue(config.protocol);
        localPathInput.value = config.localPath || "";
        projectInput.value = config.project || "";
        fetchPathInput.value = config.fetchPath || "";
        tokenInput.value = config.token || "";
        updateFetchPathWarning();
      })
      .catch((err) => {
        console.error("[NovaDebug] 팝업 상태 로드 실패", err);
      });
  }

  function init() {
    ext.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const tab = tabs && tabs[0];
        let parsed = null;
        try {
          parsed = tab && tab.url ? new URL(tab.url) : null;
        } catch {
          parsed = null;
        }
        if (!parsed || !/^https?:$/.test(parsed.protocol)) {
          showUnsupported("이 페이지에서는 사용할 수 없습니다.");
          return;
        }
        origin = parsed.origin;
        host = NovaDebugProtocol.extractHostname(origin);
        tabId = tab.id;
        siteOriginEl.textContent = origin;
        loadSiteState();
      })
      .catch((err) => {
        console.error("[NovaDebug] 활성 탭 조회 실패", err);
        showUnsupported("활성 탭을 확인할 수 없습니다.");
      });
  }

  // Firefox MV3 는 host permission 이 opt-in — 스위치 ON 시점(user gesture)에 없으면 요청한다.
  // permissions API 부재/실패는 조용히 무시(주입 자체는 storage 값만으로 동작).
  function requestHostPermissionIfNeeded() {
    if (!origin || !ext.permissions || typeof ext.permissions.contains !== "function") return;
    const originPattern = origin + "/*";
    ext.permissions
      .contains({ origins: [originPattern] })
      .then((has) => {
        if (has || typeof ext.permissions.request !== "function") return;
        return ext.permissions.request({ origins: [originPattern] });
      })
      .catch((err) => {
        console.error("[NovaDebug] host permission 요청 실패", err);
      });
  }

  // storage 변경만으로는 background 가 아직 이 탭을 activeTabs 에 등록하지 않았으면
  // (DevTools 를 안 열어본 탭) 규칙이 반영되지 않으므로, 현재 탭에는 직접 알려 즉시 적용한다.
  function notifyBackgroundToggle(enabled) {
    if (typeof tabId !== "number") return;
    ext.runtime
      .sendMessage({ type: NovaDebugProtocol.MSG.SITE_TOGGLED, tabId, enabled })
      .catch((err) => {
        console.error("[NovaDebug] 사이트 토글 background 알림 실패", err);
      });
  }

  function showToggleHint() {
    siteToggleHintEl.textContent = "페이지를 새로고침하면 적용됩니다";
    siteToggleHintEl.classList.remove("hidden");
    clearTimeout(toggleHintTimer);
    toggleHintTimer = setTimeout(() => {
      siteToggleHintEl.classList.add("hidden");
    }, 4000);
  }

  siteToggleBtn.addEventListener("click", () => {
    if (!origin || !host) return;
    const nextOn = siteToggleBtn.getAttribute("aria-checked") !== "true";
    setSwitchState(nextOn);
    NovaDebugProtocol.loadHostMap(storageArea())
      .then((hostMap) => {
        hostMap[host] = { ...(hostMap[host] || {}), enabled: nextOn };
        return storageArea().set({ [STORAGE_KEYS.HOST_MAP]: hostMap });
      })
      .then(() => {
        if (nextOn) requestHostPermissionIfNeeded();
        notifyBackgroundToggle(nextOn);
        showToggleHint();
      })
      .catch((err) => {
        console.error("[NovaDebug] 사이트 on/off 저장 실패", err);
      });
  });

  saveIdeBtn.addEventListener("click", () => {
    if (!origin || !host) return;
    if (!fetchPathWarnEl.classList.contains("hidden")) {
      const proceed = confirm(
        "⚠️ HTTP 연결에서는 디버그 데이터와 토큰이 평문 노출됩니다. 계속 저장하시겠습니까?"
      );
      if (!proceed) return;
    }
    const protocol =
      protocolSelect.value === CUSTOM_PROTOCOL_VALUE
        ? protocolCustomInput.value.trim()
        : protocolSelect.value;
    NovaDebugProtocol.loadHostMap(storageArea())
      .then((hostMap) => {
        // 기존 값(예: 옵션 페이지에서 설정한 token 오버라이드)을 지우지 않도록 spread 로 병합한다.
        hostMap[host] = {
          ...(hostMap[host] || {}),
          protocol,
          localPath: localPathInput.value.trim(),
          project: projectInput.value.trim(),
          fetchPath: fetchPathInput.value.trim(),
          token: tokenInput.value.trim(),
        };
        return storageArea().set({ [STORAGE_KEYS.HOST_MAP]: hostMap });
      })
      .then(() => {
        ideSaveStatusEl.textContent = "저장되었습니다";
        setTimeout(() => { ideSaveStatusEl.textContent = ""; }, 2000);
      })
      .catch((err) => {
        console.error("[NovaDebug] IDE 매핑 저장 실패", err);
        ideSaveStatusEl.textContent = "저장 실패: " + (err.message || err);
      });
  });

  genTokenBtn.addEventListener("click", () => {
    tokenInput.value = NovaDebugProtocol.generateToken();
  });

  copyTokenBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(tokenInput.value)
      .then(() => {
        tokenStatusEl.textContent = "복사되었습니다";
        setTimeout(() => { tokenStatusEl.textContent = ""; }, 2000);
      })
      .catch((err) => {
        console.error("[NovaDebug] 토큰 복사 실패", err);
        tokenStatusEl.textContent = "복사 실패: " + (err.message || err);
      });
  });

  openOptionsBtn.addEventListener("click", () => {
    ext.runtime.openOptionsPage();
  });

  init();
})();
