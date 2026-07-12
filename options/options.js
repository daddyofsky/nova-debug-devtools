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

  function storageArea() {
    return ext.storage.sync || ext.storage.local;
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
    removeBtn.addEventListener("click", () => tr.remove());
    removeTd.appendChild(removeBtn);

    tr.appendChild(enabledTd);
    tr.appendChild(hostTd);
    tr.appendChild(protoTd);
    tr.appendChild(pathTd);
    tr.appendChild(projectTd);
    tr.appendChild(fetchPathTd);
    tr.appendChild(tokenTd);
    tr.appendChild(removeTd);
    bodyEl.appendChild(tr);
  }

  function load() {
    Promise.all([
      NovaDebugProtocol.loadHostMap(storageArea()),
      storageArea().get(["theme", "showTime", "maxEntries", STORAGE_KEYS.TOKEN]),
    ])
      .then(([hostMap, res]) => {
        const theme = (res && res.theme) || "auto";
        themeInputs.forEach((input) => { input.checked = input.value === theme; });
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
      })
      .catch((err) => {
        console.error("[NovaDebug] 옵션 로드 실패", err);
        addRow("", {});
        renderPolicyCommands();
      });
  }

  function collectHostMap() {
    const hostMap = {};
    bodyEl.querySelectorAll("tr").forEach((tr) => {
      const hostInput = tr.querySelector(".f-host");
      hostInput.classList.remove("invalid");
      const raw = hostInput.value.trim();
      if (!raw) return;
      const host = NovaDebugProtocol.normalizeHostname(raw);
      if (!host) {
        hostInput.classList.add("invalid");
        return;
      }
      hostInput.value = host;
      const protoValue = tr.querySelector(".f-protocol").value;
      const protocol =
        protoValue === CUSTOM_PROTOCOL_VALUE
          ? tr.querySelector(".f-protocol-custom").value.trim()
          : protoValue;
      hostMap[host] = {
        enabled: tr.querySelector(".f-enabled").checked,
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
    return !!bodyEl.querySelector(".f-host.invalid") || maxEntriesEl.classList.contains("invalid");
  }

  // Chrome/Windows 정책 명령은 체크된(enabled) 호스트만 대상으로 한다 — 스킴 정보가 저장되지
  // 않으므로 host당 http/https 둘 다 등록한다.
  function enabledHostsFromRows() {
    const hosts = [];
    bodyEl.querySelectorAll("tr").forEach((tr) => {
      if (!tr.querySelector(".f-enabled").checked) return;
      const host = NovaDebugProtocol.normalizeHostname(tr.querySelector(".f-host").value);
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

  addBtn.addEventListener("click", () => addRow("", {}));

  saveBtn.addEventListener("click", () => {
    const hostMap = collectHostMap();
    const theme = collectTheme();
    const showTime = showTimeChk.checked;
    const maxEntries = collectMaxEntries();
    const debugToken = debugTokenEl.value.trim();
    if (hasInvalidInput()) {
      saveStatusEl.textContent = "잘못된 입력값이 있습니다 (빨간 테두리 입력을 확인하세요)";
      return;
    }
    storageArea()
      .set({
        [STORAGE_KEYS.HOST_MAP]: hostMap,
        theme,
        showTime,
        maxEntries,
        [STORAGE_KEYS.TOKEN]: debugToken,
      })
      .then(() => {
        saveStatusEl.textContent = "저장되었습니다";
        renderPolicyCommands();
        setTimeout(() => { saveStatusEl.textContent = ""; }, 2000);
      })
      .catch((err) => {
        console.error("[NovaDebug] 옵션 저장 실패", err);
        saveStatusEl.textContent = "저장 실패: " + (err.message || err);
      });
  });

  genTokenBtn.addEventListener("click", () => {
    debugTokenEl.value = NovaDebugProtocol.generateToken();
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
