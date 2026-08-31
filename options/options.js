/* Nova Debug — 옵션 페이지 (호스트 단위 통합 설정: 허용 여부 + IDE 매핑) */
(function () {
  const ext = NovaDebugProtocol.ext;
  const bodyEl = document.getElementById("map-body");
  const addBtn = document.getElementById("btn-add");
  const saveBtn = document.getElementById("btn-save");
  const saveStatusEl = document.getElementById("save-status");
  const chromePolicyCmdEl = document.getElementById("chrome-policy-cmd");
  const copyPolicyBtn = document.getElementById("btn-copy-policy");
  const copyStatusEl = document.getElementById("copy-status");
  const windowsPolicyCmdEl = document.getElementById("windows-policy-cmd");
  const copyWindowsPolicyBtn = document.getElementById("btn-copy-windows-policy");
  const copyWindowsStatusEl = document.getElementById("copy-windows-status");
  const themeInputs = document.querySelectorAll('input[name="theme"]');
  const showTimeChk = document.getElementById("chk-show-time");
  const maxEntriesEl = document.getElementById("max-entries");
  const debugTokenEl = document.getElementById("debug-token");
  const genTokenBtn = document.getElementById("btn-gen-token");
  const copyTokenBtn = document.getElementById("btn-copy-token");
  const tokenStatusEl = document.getElementById("token-status");

  const PROTOCOLS = ["phpstorm", "idea", "vscode"];
  const CUSTOM_PROTOCOL_VALUE = "__custom__";
  const STORAGE_KEYS = NovaDebugProtocol.STORAGE_KEYS;

  // 페이지 헤더 — 확장 이름/버전 (manifest 가 단일 출처)
  const manifest = ext.runtime.getManifest();
  document.getElementById("ext-name").textContent = manifest.name;
  document.getElementById("ext-version").textContent = "v" + manifest.version;

  // 설정 페이지도 테마 설정을 따른다 — auto 는 속성을 제거해 OS 다크 모드(media query)에 위임
  function applyTheme(theme) {
    if (theme === "dark" || theme === "light") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  // 라디오 선택 즉시 미리보기 (저장 전에는 storage 에 반영되지 않는다)
  themeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) applyTheme(input.value);
      markDirty();
    });
  });

  function storageArea() {
    return ext.storage.sync || ext.storage.local;
  }

  // isDirty: 로드 이후 사용자가 편집했는지 여부 — 편집 중에는 외부 변경을 조용히 덮어쓰지 않는다.
  // suppressOwnChange: 저장이 만든 storage.onChanged 를 외부 변경으로 오인하지 않기 위한 가드.
  // (load()는 걸지 않는다 — loadHostMap()은 HOST_MAP이 이미 있으면 write하지 않으므로 보통 onChanged를
  // 유발하지 않고, 최초 1회 마이그레이션 write로 onChanged가 뜨더라도 그 시점엔 isDirty가 아직 false라
  // 리스너가 조용한 재로드로 처리한다. load()에 걸면 매 로드마다 1초간 실제 외부 변경을 놓치게 된다.)
  let isDirty = false;
  let suppressOwnChange = false;
  let saveBlocked = false;

  function markDirty() {
    isDirty = true;
  }

  function suppressNextChangeBriefly() {
    suppressOwnChange = true;
    setTimeout(() => { suppressOwnChange = false; }, 1000);
  }

  function blockSave(message) {
    saveBlocked = true;
    saveBtn.disabled = true;
    saveStatusEl.textContent = message;
  }

  function addRow(host, config) {
    config = config || {};
    const tr = document.createElement("tr");

    const enabledTd = document.createElement("td");
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.className = "f-enabled";
    enabledInput.checked = !!config.enabled;
    enabledTd.appendChild(enabledInput);

    const captureOnOpenTd = document.createElement("td");
    const captureOnOpenInput = document.createElement("input");
    captureOnOpenInput.type = "checkbox";
    captureOnOpenInput.className = "f-capture-open";
    captureOnOpenInput.checked = !!config.captureOnOpen;
    captureOnOpenTd.appendChild(captureOnOpenInput);

    const hostTd = document.createElement("td");
    const hostInput = document.createElement("input");
    hostInput.type = "text";
    hostInput.className = "f-host";
    hostInput.placeholder = "example.com";
    hostInput.value = host || "";
    hostTd.appendChild(hostInput);

    const protoTd = document.createElement("td");
    const isCustomProtocol = !!config.protocol && !PROTOCOLS.includes(config.protocol);
    const protoSelect = document.createElement("select");
    protoSelect.className = "f-protocol";
    PROTOCOLS.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      if ((config.protocol || "phpstorm") === p) opt.selected = true;
      protoSelect.appendChild(opt);
    });
    const customOpt = document.createElement("option");
    customOpt.value = CUSTOM_PROTOCOL_VALUE;
    customOpt.textContent = "직접입력";
    if (isCustomProtocol) customOpt.selected = true;
    protoSelect.appendChild(customOpt);

    const protoCustomInput = document.createElement("input");
    protoCustomInput.type = "text";
    protoCustomInput.className = "f-protocol-custom";
    protoCustomInput.value = isCustomProtocol ? config.protocol : "";
    protoCustomInput.style.display = isCustomProtocol ? "" : "none";

    protoSelect.addEventListener("change", () => {
      protoCustomInput.style.display = protoSelect.value === CUSTOM_PROTOCOL_VALUE ? "" : "none";
      if (protoSelect.value === CUSTOM_PROTOCOL_VALUE) protoCustomInput.focus();
    });

    protoTd.appendChild(protoSelect);
    protoTd.appendChild(protoCustomInput);

    const pathTd = document.createElement("td");
    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.className = "f-localpath";
    pathInput.value = config.localPath || "";
    pathTd.appendChild(pathInput);

    const projectTd = document.createElement("td");
    const projectInput = document.createElement("input");
    projectInput.type = "text";
    projectInput.className = "f-project";
    projectInput.placeholder = "(선택)";
    projectInput.value = config.project || "";
    projectTd.appendChild(projectInput);

    const fetchPathTd = document.createElement("td");
    const fetchPathInput = document.createElement("input");
    fetchPathInput.type = "text";
    fetchPathInput.className = "f-fetchpath";
    fetchPathInput.placeholder = "(기본값: " + NovaDebugProtocol.DEFAULT_FETCH_PATH + ")";
    fetchPathInput.value = config.fetchPath || "";
    fetchPathTd.appendChild(fetchPathInput);

    const tokenTd = document.createElement("td");
    const tokenWrap = document.createElement("div");
    tokenWrap.className = "f-token-wrap";
    const tokenInput = document.createElement("input");
    tokenInput.type = "text";
    tokenInput.className = "f-token";
    tokenInput.placeholder = "(공통 토큰 사용)";
    tokenInput.value = config.token || "";
    const tokenGenBtn = document.createElement("button");
    tokenGenBtn.type = "button";
    tokenGenBtn.className = "icon-btn";
    tokenGenBtn.title = "토큰 생성";
    tokenGenBtn.textContent = "🎲";
    tokenGenBtn.addEventListener("click", () => {
      tokenInput.value = NovaDebugProtocol.generateToken();
      markDirty();
    });
    const tokenCopyBtn = document.createElement("button");
    tokenCopyBtn.type = "button";
    tokenCopyBtn.className = "icon-btn";
    tokenCopyBtn.title = "토큰 복사";
    tokenCopyBtn.textContent = "📋";
    tokenCopyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(tokenInput.value).catch((err) => {
        console.error("[NovaDebug] 토큰 복사 실패", err);
      });
    });
    tokenWrap.appendChild(tokenInput);
    tokenWrap.appendChild(tokenGenBtn);
    tokenWrap.appendChild(tokenCopyBtn);
    tokenTd.appendChild(tokenWrap);

    const removeTd = document.createElement("td");
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-remove";
    removeBtn.textContent = "삭제";
    removeBtn.addEventListener("click", () => {
      tr.remove();
      markDirty();
    });
    removeTd.appendChild(removeBtn);

    tr.appendChild(enabledTd);
    tr.appendChild(captureOnOpenTd);
    tr.appendChild(hostTd);
    tr.appendChild(protoTd);
    tr.appendChild(pathTd);
    tr.appendChild(projectTd);
    tr.appendChild(fetchPathTd);
    tr.appendChild(tokenTd);
    tr.appendChild(removeTd);
    bodyEl.appendChild(tr);
  }

  // 표 안 입력(호스트 행)은 동적으로 추가되므로 bodyEl 에 위임해 편집 여부를 감지한다.
  bodyEl.addEventListener("input", markDirty);
  bodyEl.addEventListener("change", markDirty);
  showTimeChk.addEventListener("change", markDirty);
  maxEntriesEl.addEventListener("input", markDirty);
  debugTokenEl.addEventListener("input", markDirty);

  function load() {
    while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
    Promise.all([
      NovaDebugProtocol.loadHostMap(storageArea()),
      storageArea().get(["theme", "showTime", "maxEntries", STORAGE_KEYS.TOKEN]),
    ])
      .then(([hostMap, res]) => {
        const theme = (res && res.theme) || "auto";
        themeInputs.forEach((input) => { input.checked = input.value === theme; });
        applyTheme(theme);
        showTimeChk.checked = !(res && res.showTime === false);
        const maxEntriesVal = res && res.maxEntries;
        maxEntriesEl.value = (typeof maxEntriesVal === "number" && maxEntriesVal > 0) ? maxEntriesVal : 100;
        debugTokenEl.value = (res && res[STORAGE_KEYS.TOKEN]) || "";

        const hosts = Object.keys(hostMap);
        if (hosts.length === 0) {
          addRow("", {});
        } else {
          hosts.forEach((host) => addRow(host, hostMap[host]));
        }
        renderPolicyCommands();
        isDirty = false;
        saveBlocked = false;
        saveBtn.disabled = false;
        saveStatusEl.textContent = "";
      })
      .catch((err) => {
        console.error("[NovaDebug] 옵션 로드 실패", err);
        addRow("", {});
        renderPolicyCommands();
        blockSave("설정을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.");
      });
  }

  function collectHostMap() {
    const rows = Array.from(bodyEl.querySelectorAll("tr"));
    const hostCounts = {};

    // 1차: 형식 검증 + 정규화된 host 별 등장 횟수 집계 (중복 판정은 전체 행을 봐야 하므로 분리)
    const parsedRows = rows.map((tr) => {
      const hostInput = tr.querySelector(".f-host");
      hostInput.classList.remove("invalid");
      hostInput.removeAttribute("title");
      const raw = hostInput.value.trim();
      if (!raw) return { tr, host: null };
      const host = NovaDebugProtocol.normalizeHostKey(raw);
      if (!host) {
        hostInput.classList.add("invalid");
        hostInput.title = "올바른 호스트 형식이 아닙니다 (example.com, *.example.com, /정규식/)";
        return { tr, host: null };
      }
      hostCounts[host] = (hostCounts[host] || 0) + 1;
      return { tr, host };
    });

    const hostMap = {};
    parsedRows.forEach(({ tr, host }) => {
      if (!host) return;
      const hostInput = tr.querySelector(".f-host");
      if (hostCounts[host] > 1) {
        hostInput.classList.add("invalid");
        hostInput.title = "중복된 호스트입니다";
        return;
      }
      hostInput.value = host;

      const protoCustomInput = tr.querySelector(".f-protocol-custom");
      protoCustomInput.classList.remove("invalid");
      const protoValue = tr.querySelector(".f-protocol").value;
      const protocol =
        protoValue === CUSTOM_PROTOCOL_VALUE
          ? protoCustomInput.value.trim()
          : protoValue;
      if (protoValue === CUSTOM_PROTOCOL_VALUE && !protocol) {
        protoCustomInput.classList.add("invalid");
        return;
      }

      hostMap[host] = {
        enabled: tr.querySelector(".f-enabled").checked,
        captureOnOpen: tr.querySelector(".f-capture-open").checked,
        protocol,
        localPath: tr.querySelector(".f-localpath").value.trim(),
        project: tr.querySelector(".f-project").value.trim(),
        fetchPath: tr.querySelector(".f-fetchpath").value.trim(),
        token: tr.querySelector(".f-token").value.trim(),
      };
    });
    return hostMap;
  }

  function collectTheme() {
    const checked = document.querySelector('input[name="theme"]:checked');
    return checked ? checked.value : "auto";
  }

  function collectMaxEntries() {
    maxEntriesEl.classList.remove("invalid");
    const val = parseInt(maxEntriesEl.value, 10);
    if (!Number.isFinite(val) || val < 1) {
      maxEntriesEl.classList.add("invalid");
      return null;
    }
    return val;
  }

  function hasInvalidInput() {
    return (
      !!bodyEl.querySelector(".f-host.invalid") ||
      !!bodyEl.querySelector(".f-protocol-custom.invalid") ||
      maxEntriesEl.classList.contains("invalid")
    );
  }

  // Chrome/Windows 정책 명령은 체크된(enabled) 호스트만 대상으로 한다 — 스킴 정보가 저장되지
  // 않으므로 host당 http/https 둘 다 등록한다. 패턴 키 중 "*.foo.com" 은 base 도메인으로
  // 치환하고(정책 URL 패턴은 서브도메인을 기본 포함), 그 외(라벨 내 *, 정규식)는 정책으로
  // 표현할 수 없어 제외한다.
  function policyHostForKey(key) {
    if (!key) return null;
    if (NovaDebugProtocol.isRegexHostKey(key)) return null;
    if (key.startsWith("*.") && !key.slice(2).includes("*")) return key.slice(2);
    if (key.includes("*")) return null;
    return key;
  }

  function enabledHostsFromRows() {
    const hosts = [];
    bodyEl.querySelectorAll("tr").forEach((tr) => {
      if (!tr.querySelector(".f-enabled").checked) return;
      const key = NovaDebugProtocol.normalizeHostKey(tr.querySelector(".f-host").value);
      const host = policyHostForKey(key);
      if (host && !hosts.includes(host)) hosts.push(host);
    });
    return hosts;
  }

  function enabledProtocols() {
    const set = new Set();
    bodyEl.querySelectorAll("tr").forEach((tr) => {
      if (!tr.querySelector(".f-enabled").checked) return;
      const protoValue = tr.querySelector(".f-protocol").value;
      const protocol =
        protoValue === CUSTOM_PROTOCOL_VALUE
          ? tr.querySelector(".f-protocol-custom").value.trim()
          : protoValue;
      if (protocol) set.add(protocol);
    });
    return set.size ? Array.from(set) : ["phpstorm"];
  }

  function originsForHosts(hosts) {
    if (!hosts.length) return ["https://example.com"];
    const origins = [];
    hosts.forEach((host) => {
      origins.push("http://" + host, "https://" + host);
    });
    return origins;
  }

  // Chrome AutoLaunchProtocolsFromOrigins 정책은 XML plist 조각을 -array 인자로 받는다.
  function escapeXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // dict 전체가 shell 의 single-quote 인자 하나로 감싸이므로, 값에 ' 가 있으면 셸 인자가 깨진다.
  function shellSingleQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function buildChromePolicyCommand(hosts, protocols) {
    const origins = originsForHosts(hosts);
    const dicts = protocols.map((protocol) => {
      const originsXml = origins.map((o) => "<string>" + escapeXml(o) + "</string>").join("");
      const dictXml =
        "<dict><key>protocol</key><string>" + escapeXml(protocol) + "</string>" +
        "<key>allowed_origins</key><array>" + originsXml + "</array></dict>";
      return shellSingleQuote(dictXml);
    });
    return "defaults write com.google.Chrome AutoLaunchProtocolsFromOrigins -array \\\n  " +
      dicts.join(" \\\n  ");
  }

  // .reg 의 REG_SZ 값은 큰따옴표로 감싸이므로 그 안의 JSON 문자열에서 \ 와 " 를 각각 \\ , \" 로 이스케이프한다.
  function escapeRegValue(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function buildWindowsPolicyCommand(hosts, protocols) {
    const origins = originsForHosts(hosts);
    const entries = protocols.map((protocol) => ({ protocol, allowed_origins: origins }));
    const json = escapeRegValue(JSON.stringify(entries));
    return (
      "Windows Registry Editor Version 5.00\r\n\r\n" +
      "[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome]\r\n" +
      '"AutoLaunchProtocolsFromOrigins"="' + json + '"\r\n'
    );
  }

  function renderPolicyCommands() {
    const hosts = enabledHostsFromRows();
    const protocols = enabledProtocols();
    chromePolicyCmdEl.textContent = buildChromePolicyCommand(hosts, protocols);
    windowsPolicyCmdEl.textContent = buildWindowsPolicyCommand(hosts, protocols);
  }

  // ------------------------------------------------------------
  // 단축키 (commands.toggle-site)
  // Firefox: commands.update/reset 으로 옵션 페이지에서 직접 변경.
  // Chrome: 확장 API 로 변경 불가 — chrome://extensions/shortcuts 열기 버튼만 제공.
  // ------------------------------------------------------------

  const shortcutSectionEls = [document.getElementById("shortcut-section")];
  const shortcutCurrentEl = document.getElementById("shortcut-current");
  const shortcutFirefoxEl = document.getElementById("shortcut-firefox-controls");
  const shortcutInputEl = document.getElementById("shortcut-input");
  const applyShortcutBtn = document.getElementById("btn-apply-shortcut");
  const resetShortcutBtn = document.getElementById("btn-reset-shortcut");
  const openShortcutsBtn = document.getElementById("btn-open-shortcuts");
  const shortcutStatusEl = document.getElementById("shortcut-status");
  const shortcutHintEl = document.getElementById("shortcut-hint");
  const TOGGLE_COMMAND = "toggle-site";
  const isMac = /Mac/.test(navigator.platform);

  function setShortcutStatus(text) {
    shortcutStatusEl.textContent = text;
    setTimeout(() => { shortcutStatusEl.textContent = ""; }, 3000);
  }

  function refreshCurrentShortcut() {
    return ext.commands.getAll().then((cmds) => {
      const cmd = cmds.find((c) => c.name === TOGGLE_COMMAND);
      shortcutCurrentEl.value = (cmd && cmd.shortcut) || "(설정 안 됨)";
    });
  }

  // keydown 이벤트 → manifest 형식("Command+F12" 등) 조합 문자열. 미완성 조합이면 null.
  function shortcutFromEvent(e) {
    const mods = [];
    if (e.metaKey) mods.push("Command");
    if (e.ctrlKey) mods.push(isMac ? "MacCtrl" : "Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");

    let key = null;
    if (/^F([1-9]|1[0-2])$/.test(e.key)) key = e.key;
    else if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
    else if (/^[0-9]$/.test(e.key)) key = e.key;
    else {
      const named = {
        ",": "Comma", ".": "Period", " ": "Space",
        Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
        Insert: "Insert", Delete: "Delete",
        ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
      };
      key = named[e.key] || null;
    }
    if (!key) return null;

    // F키는 단독 허용, 그 외에는 Shift 외 modifier 1개 이상 필요 (Firefox 규칙)
    const hasRealMod = mods.some((m) => m !== "Shift");
    if (!/^F/.test(key) && !hasRealMod) return null;
    return mods.concat(key).join("+");
  }

  function initShortcutSection() {
    if (!ext.commands || typeof ext.commands.getAll !== "function") {
      shortcutSectionEls.forEach((el) => el && el.classList.add("hidden"));
      return;
    }
    refreshCurrentShortcut().catch((err) => {
      console.error("[NovaDebug] 단축키 조회 실패", err);
    });

    if (typeof ext.commands.update === "function") {
      shortcutFirefoxEl.classList.remove("hidden");
      shortcutHintEl.textContent =
        "입력칸을 클릭한 뒤 원하는 키 조합을 누르고 적용을 누르세요. F키는 단독 사용 가능, 그 외에는 Ctrl/Alt/Command 조합이 필요합니다.";

      shortcutInputEl.addEventListener("keydown", (e) => {
        e.preventDefault();
        const combo = shortcutFromEvent(e);
        if (combo) shortcutInputEl.value = combo;
      });

      applyShortcutBtn.addEventListener("click", () => {
        const shortcut = shortcutInputEl.value.trim();
        if (!shortcut) return;
        ext.commands
          .update({ name: TOGGLE_COMMAND, shortcut })
          .then(() => refreshCurrentShortcut())
          .then(() => {
            shortcutInputEl.value = "";
            setShortcutStatus("변경되었습니다");
          })
          .catch((err) => {
            console.error("[NovaDebug] 단축키 변경 실패", err);
            setShortcutStatus("변경 실패: " + (err.message || err));
          });
      });

      resetShortcutBtn.addEventListener("click", () => {
        ext.commands
          .reset(TOGGLE_COMMAND)
          .then(() => refreshCurrentShortcut())
          .then(() => setShortcutStatus("기본값으로 복원되었습니다"))
          .catch((err) => {
            console.error("[NovaDebug] 단축키 복원 실패", err);
            setShortcutStatus("복원 실패: " + (err.message || err));
          });
      });
    } else {
      // Chrome — 브라우저 설정 페이지로 안내
      openShortcutsBtn.classList.remove("hidden");
      shortcutHintEl.textContent =
        "Chrome은 확장에서 단축키를 직접 변경할 수 없습니다. 아래 버튼으로 브라우저 단축키 설정을 열어 변경하세요 (F키는 Chrome에서 지원되지 않습니다).";
      openShortcutsBtn.addEventListener("click", () => {
        ext.tabs.create({ url: "chrome://extensions/shortcuts" }).catch((err) => {
          console.error("[NovaDebug] 단축키 설정 페이지 열기 실패", err);
          setShortcutStatus("열기 실패 — 주소창에 chrome://extensions/shortcuts 입력");
        });
      });
    }
  }
  initShortcutSection();

  addBtn.addEventListener("click", () => {
    addRow("", {});
    markDirty();
  });

  saveBtn.addEventListener("click", () => {
    if (saveBlocked) return;
    const hostMap = collectHostMap();
    const theme = collectTheme();
    const showTime = showTimeChk.checked;
    const maxEntries = collectMaxEntries();
    const debugToken = debugTokenEl.value.trim();
    if (hasInvalidInput()) {
      saveStatusEl.textContent = "잘못된 입력값이 있습니다 (빨간 테두리 입력을 확인하세요)";
      return;
    }
    suppressNextChangeBriefly();
    storageArea()
      .set({
        [STORAGE_KEYS.HOST_MAP]: hostMap,
        theme,
        showTime,
        maxEntries,
        [STORAGE_KEYS.TOKEN]: debugToken,
      })
      .then(() => {
        isDirty = false;
        saveStatusEl.textContent = "저장되었습니다";
        renderPolicyCommands();
        setTimeout(() => { saveStatusEl.textContent = ""; }, 2000);
      })
      .catch((err) => {
        console.error("[NovaDebug] 옵션 저장 실패", err);
        saveStatusEl.textContent = "저장 실패: " + (err.message || err);
      });
  });

  // 팝업/단축키 등 다른 곳에서 hostMap/토큰이 바뀌면: 편집 중이 아니면 조용히 재로드,
  // 편집 중이면 저장 시 원복되지 않도록 경고 후 저장을 막는다. 자신의 저장/로드가 만든
  // 이벤트는 suppressOwnChange 로 걸러 외부 변경으로 오인하지 않는다.
  if (ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (!changes[STORAGE_KEYS.HOST_MAP] && !changes[STORAGE_KEYS.TOKEN]) return;
      if (suppressOwnChange) {
        suppressOwnChange = false;
        return;
      }
      if (isDirty) {
        blockSave("다른 곳에서 설정이 변경되었습니다 — 새로고침 후 다시 시도하세요.");
      } else {
        load();
      }
    });
  }

  genTokenBtn.addEventListener("click", () => {
    debugTokenEl.value = NovaDebugProtocol.generateToken();
    markDirty();
  });

  copyTokenBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(debugTokenEl.value)
      .then(() => {
        tokenStatusEl.textContent = "복사되었습니다";
        setTimeout(() => { tokenStatusEl.textContent = ""; }, 2000);
      })
      .catch((err) => {
        console.error("[NovaDebug] 토큰 복사 실패", err);
        tokenStatusEl.textContent = "복사 실패: " + (err.message || err);
      });
  });

  copyPolicyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(chromePolicyCmdEl.textContent)
      .then(() => {
        copyStatusEl.textContent = "복사되었습니다";
        setTimeout(() => { copyStatusEl.textContent = ""; }, 2000);
      })
      .catch((err) => {
        console.error("[NovaDebug] 클립보드 복사 실패", err);
        copyStatusEl.textContent = "복사 실패: " + (err.message || err);
      });
  });

  copyWindowsPolicyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(windowsPolicyCmdEl.textContent)
      .then(() => {
        copyWindowsStatusEl.textContent = "복사되었습니다";
        setTimeout(() => { copyWindowsStatusEl.textContent = ""; }, 2000);
      })
      .catch((err) => {
        console.error("[NovaDebug] 클립보드 복사 실패", err);
        copyWindowsStatusEl.textContent = "복사 실패: " + (err.message || err);
      });
  });

  load();
})();
