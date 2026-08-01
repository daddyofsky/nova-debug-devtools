/* Nova Debug — devtools panel 컨트롤러 (순수 UI. 수집 계층은 devtools/devtools.js 가 소유) */
(function () {
  const ext = NovaDebugProtocol.ext;

  const Renderer = window.NovaDebugRenderer;

  const listEl = document.getElementById("request-list");
  const detailHeaderMainEl = document.getElementById("detail-header-main");
  const detailHeaderSummaryEl = document.getElementById("detail-header-summary");
  const statusEl = document.getElementById("status");
  const clearBtn = document.getElementById("btn-clear");
  const openOptionsBtn = document.getElementById("btn-open-options");
  const preserveChk = document.getElementById("chk-preserve");
  const captureOpenChk = document.getElementById("chk-capture-open");
  const captureOpenLabel = document.getElementById("capture-open-label");
  const captureNoticeEl = document.getElementById("capture-notice");
  const filterInputEl = document.getElementById("filter-input");
  const showTimeChk = document.getElementById("chk-show-time");
  const tabBarEl = document.getElementById("tab-bar");
  const tabContentEl = document.getElementById("tab-content");
  const tabPanels = {
    dumps: document.getElementById("tab-dumps"),
    queries: document.getElementById("tab-queries"),
    timeline: document.getElementById("tab-timeline"),
    files: document.getElementById("tab-files"),
    raw: document.getElementById("tab-raw"),
  };

  const mainEl = document.getElementById("main");
  const splitHandleEl = document.getElementById("split-h");

  // devtools.js 가 소유한 entries 배열 참조 — __novaAttach 로 주입되기 전까지는 빈 배열.
  let entries = [];
  let shared = null;
  let selectedEntry = null;
  let activeTab = "dumps";
  let hostMap = {};
  let filterText = "";
  let userTheme = "auto";
  let devtoolsThemeName = ext.devtools.panels.themeName;
  let showTime = true;
  // 탭별 독립 검색어 — entry 전환 시에도 유지한다 (탭 간에는 공유하지 않음)
  const tabSearch = { dumps: "", queries: "", files: "" };

  // 평상시(정상 연결)에는 숨기고, connecting/reconnecting 등 비정상 상태일 때만 경고 톤으로 표시한다.
  function setStatus(text) {
    statusEl.textContent = text;
    const isNormal = /^listening/.test(text || "");
    statusEl.classList.toggle("status-hidden", isNormal);
    statusEl.classList.toggle("status-warn", !isNormal);
  }

  // ------------------------------------------------------------
  // 호스트 매핑 (options 페이지에서 저장) — hostname 별 {enabled, protocol, localPath, project, ...}
  // ------------------------------------------------------------

  function storageArea() {
    return (ext.storage.sync) || ext.storage.local;
  }

  function loadHostMap() {
    return NovaDebugProtocol.loadHostMap(storageArea())
      .then((res) => {
        hostMap = res || {};
      })
      .catch((err) => {
        console.error("[NovaDebug] hostMap 로드 실패", err);
        hostMap = {};
      });
  }

  function loadTheme() {
    return storageArea()
      .get("theme")
      .then((res) => {
        userTheme = (res && res.theme) || "auto";
        applyTheme();
      })
      .catch((err) => {
        console.error("[NovaDebug] theme 로드 실패", err);
      });
  }

  function loadShowTime() {
    return storageArea()
      .get("showTime")
      .then((res) => {
        showTime = !(res && res.showTime === false);
        showTimeChk.checked = showTime;
        renderList();
      })
      .catch((err) => {
        console.error("[NovaDebug] showTime 로드 실패", err);
      });
  }

  if (ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (changes[NovaDebugProtocol.STORAGE_KEYS.HOST_MAP]) {
        hostMap = changes[NovaDebugProtocol.STORAGE_KEYS.HOST_MAP].newValue || {};
        refreshCaptureControl();
        if (selectedEntry) renderDetail(selectedEntry);
      }
      if (changes.theme) {
        userTheme = changes.theme.newValue || "auto";
        applyTheme();
      }
      if (changes.showTime) {
        showTime = changes.showTime.newValue !== false;
        showTimeChk.checked = showTime;
        renderList();
      }
    });
  }

  showTimeChk.addEventListener("change", () => {
    storageArea()
      .set({ showTime: showTimeChk.checked })
      .catch((err) => {
        console.error("[NovaDebug] showTime 저장 실패", err);
      });
  });

  function ideConfigForUrl(url) {
    const host = NovaDebugProtocol.extractHostname(url);
    return (host && hostMap[host]) || {};
  }

  // ------------------------------------------------------------
  // 사이트별 "DevTools 오픈 시 캡쳐"(hostMap[host].captureOnOpen) 체크박스
  // 기본은 패널(Nova Debug 탭) 첫 표시부터 캡쳐 — 체크하면 DevTools 오픈 즉시 캡쳐.
  // DevTools 를 프로그램으로 재시작할 방법이 없어 변경은 다음 오픈부터 적용 → 안내 필수.
  // ------------------------------------------------------------

  let captureHost = null;
  let captureNoticeTimer = null;
  let captureNoticeSticky = false; // 토글 직후 안내가 hover 이탈로 지워지지 않도록

  function captureModeText() {
    return captureOpenChk.checked
      ? "DevTools가 열려 있는 동안 항상 캡쳐합니다"
      : "캡쳐는 Nova Debug 탭이 표시된 동안 수행됩니다 — 페이지를 리로드하세요";
  }

  function showCaptureNotice(text) {
    captureNoticeSticky = true;
    captureNoticeEl.textContent = text;
    if (captureNoticeTimer) clearTimeout(captureNoticeTimer);
    captureNoticeTimer = setTimeout(() => {
      captureNoticeSticky = false;
      captureNoticeEl.textContent = "";
    }, 6000);
  }

  captureOpenLabel.addEventListener("mouseenter", () => {
    if (captureNoticeSticky || captureOpenChk.disabled) return;
    captureNoticeEl.textContent = captureModeText();
  });
  captureOpenLabel.addEventListener("mouseleave", () => {
    if (captureNoticeSticky) return;
    captureNoticeEl.textContent = "";
  });

  function refreshCaptureControl() {
    const url = shared && typeof shared.getPageUrl === "function" ? shared.getPageUrl() : "";
    captureHost = NovaDebugProtocol.extractHostname(url);
    const entry = (captureHost && hostMap[captureHost]) || null;
    const usable = !!(entry && entry.enabled);
    captureOpenChk.disabled = !usable;
    captureOpenChk.checked = !!(entry && entry.captureOnOpen);
    captureOpenLabel.classList.toggle("disabled", !usable);
    captureOpenLabel.title = usable
      ? "현재 사이트: " + captureHost
      : "현재 사이트" + (captureHost ? "(" + captureHost + ")" : "") +
        "가 허용 호스트가 아닙니다 — 팝업 또는 전체설정에서 먼저 활성화하세요.";
  }

  captureOpenChk.addEventListener("change", () => {
    const host = captureHost;
    const checked = captureOpenChk.checked;
    if (!host) return;
    // 저장 직전에 최신 hostMap 을 다시 읽어 다른 필드(옵션 페이지 편집분)를 덮어쓰지 않는다.
    NovaDebugProtocol.loadHostMap(storageArea())
      .then((map) => {
        const entry = map[host];
        if (!entry || !entry.enabled) {
          refreshCaptureControl();
          return;
        }
        entry.captureOnOpen = checked;
        // 안내는 저장 성공 체인 안에서 — set() 의 resolve 값은 브라우저마다 달라
        // (Chrome undefined / Firefox null) 바깥 then 에서 값으로 분기하면 안 된다.
        return storageArea()
          .set({ [NovaDebugProtocol.STORAGE_KEYS.HOST_MAP]: map })
          .then(() => {
            showCaptureNotice(captureModeText() + " (다음 DevTools 오픈부터 적용)");
          });
      })
      .catch((err) => {
        console.error("[NovaDebug] captureOnOpen 저장 실패", err);
        showCaptureNotice("저장 실패: " + (err.message || err));
        refreshCaptureControl();
      });
  });

  // ------------------------------------------------------------
  // 목록 (요청 통계 뱃지 포함)
  // ------------------------------------------------------------

  function urlPath(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url;
    }
  }

  function matchesFilter(entry) {
    if (!filterText) return true;
    return (
      entry.method.toLowerCase().includes(filterText) ||
      urlPath(entry.url).toLowerCase().includes(filterText)
    );
  }

  function renderList() {
    listEl.textContent = "";
    for (const entry of entries.filter(matchesFilter)) {
      const row = document.createElement("div");
      row.className = "row";
      if (entry.error) row.classList.add("row-error");
      if (entry.stats && entry.stats.hasError) row.classList.add("row-data-error");
      if (selectedEntry === entry) row.classList.add("row-selected");

      if (showTime) {
        const time = document.createElement("span");
        time.className = "col-time";
        time.textContent = entry.time.toLocaleTimeString();
        row.appendChild(time);
      }

      const method = document.createElement("span");
      method.className = "col-method";
      method.textContent = entry.method;

      const url = document.createElement("span");
      url.className = "col-url";
      url.textContent = urlPath(entry.url);
      url.title = entry.url;

      const badges = document.createElement("span");
      badges.className = "col-badges";
      if (entry.stats) {
        if (entry.stats.queryCount) {
          const b = document.createElement("span");
          b.className = "list-badge list-badge-query";
          b.textContent = "Q" + entry.stats.queryCount;
          b.title = "쿼리 " + entry.stats.queryCount + "건";
          badges.appendChild(b);
        }
        if (entry.stats.slowCount) {
          const b = document.createElement("span");
          b.className = "list-badge list-badge-slow";
          b.textContent = "S" + entry.stats.slowCount;
          b.title = "slow query " + entry.stats.slowCount + "건";
          badges.appendChild(b);
        }
        if (entry.stats.hasError) {
          const b = document.createElement("span");
          b.className = "list-badge list-badge-error";
          b.textContent = "ERR";
          b.title = "에러 포함";
          badges.appendChild(b);
        }
        if (entry.stats.hasRedirect) {
          const b = document.createElement("span");
          b.className = "list-badge list-badge-redirect";
          b.textContent = "RDR";
          b.title = "리다이렉트";
          badges.appendChild(b);
        }
      }

      row.appendChild(method);
      row.appendChild(url);
      row.appendChild(badges);

      row.addEventListener("click", () => selectEntry(entry));
      listEl.appendChild(row);
    }
  }

  // ------------------------------------------------------------
  // 상세 (탭)
  // ------------------------------------------------------------

  function setTabCount(tab, count) {
    const el = tabBarEl.querySelector('.tab-btn[data-tab="' + tab + '"] .tab-count');
    if (el) el.textContent = (count === null || count === undefined) ? "" : String(count);
  }

  function updateTabCounts(entry) {
    const data = entry && entry.data;
    const isV2 = data && data.schemaVersion === 2;
    setTabCount("dumps", isV2 ? data.entries.length : null);
    setTabCount("queries", isV2 ? data.summary.queries.count : null);
    setTabCount("files", isV2 ? data.summary.files.count : null);
  }

  function clearTabPanels() {
    Object.values(tabPanels).forEach((el) => {
      el.innerHTML = "";
    });
  }

  function showMessage(text) {
    clearTabPanels();
    tabPanels[activeTab].innerHTML = '<p class="d-empty-msg"></p>';
    tabPanels[activeTab].querySelector(".d-empty-msg").textContent = text;
  }

  function selectRowInDumps(index) {
    switchTab("dumps");
    const row = tabPanels.dumps.querySelector("#d-row-" + index);
    if (!row) return;
    if (row.classList.contains("d-lazy")) {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    row.classList.add("on");
    row.scrollIntoView({ block: "center" });
  }

  function renderActiveTab(entry) {
    const data = entry.data;
    if (activeTab !== "raw" && data.schemaVersion !== 2) {
      tabPanels[activeTab].innerHTML = '<p class="d-empty-msg"></p>';
      tabPanels[activeTab].querySelector(".d-empty-msg").textContent =
        "지원하지 않는 스키마 버전(schemaVersion=" + data.schemaVersion + ") — Raw 탭에서 원본 데이터를 확인하세요.";
      return;
    }
    const ideConfig = ideConfigForUrl(entry.url);
    if (!entry.pinned) entry.pinned = new Set();
    const opts = {
      slowQueryThreshold: (data.thresholds && data.thresholds.slowQueryTime) || 0,
      tooManyCount: (data.thresholds && data.thresholds.tooManyCount) || 0,
      ideConfig,
      data, // frames[]/files[] 해석(resolveTrace 등)을 위해 렌더러에 원본 v1 페이로드를 전달
      onSelect: selectRowInDumps,
      isPinned: (idx) => entry.pinned.has(idx),
      onTogglePin: (idx) => {
        if (entry.pinned.has(idx)) entry.pinned.delete(idx);
        else entry.pinned.add(idx);
        return entry.pinned.has(idx);
      },
      searchText: tabSearch[activeTab] || "",
      onSearchChange: (val) => { tabSearch[activeTab] = val; },
    };

    if (activeTab === "dumps") {
      Renderer.RowRenderer.renderDumpsTab(tabPanels.dumps, data, opts);
    } else if (activeTab === "queries") {
      Renderer.QueryRenderer.renderQueriesTab(tabPanels.queries, data, opts);
    } else if (activeTab === "timeline") {
      Renderer.Timeline.renderTimeline(tabPanels.timeline, data, opts);
    } else if (activeTab === "files") {
      renderFilesTab(tabPanels.files, data, ideConfig);
    } else if (activeTab === "raw") {
      Renderer.JsonView.render(tabPanels.raw, data);
    }
  }

  // x-nova.fileHighlight 색상명은 CSS 클래스로 쓰이므로 팔레트에 있는 이름만 허용한다
  const FILE_HIGHLIGHT_COLORS = new Set([
    "blue", "green", "orange", "red", "purple", "teal", "pink", "brown", "gray", "black",
  ]);

  function renderFilesTab(container, data, ideConfig) {
    const escHtml = Renderer.escHtml;
    const fileHighlight = (data["x-nova"] && data["x-nova"].fileHighlight) || null;
    function pathHtml(path) {
      if (fileHighlight) {
        for (const match in fileHighlight) {
          if (path.indexOf(match) !== -1 && FILE_HIGHLIGHT_COLORS.has(fileHighlight[match])) {
            return '<span class="d-fh-' + fileHighlight[match] + '">' + escHtml(path) + "</span>";
          }
        }
      }
      return escHtml(path);
    }
    let rowsHtml = "";
    (data.files || []).forEach((f, idx) => {
      const link = Renderer.IdeLink.build(f.path, 0, ideConfig);
      const open = link ? '<a href="' + escHtml(link) + '">' : "<span>";
      const close = link ? "</a>" : "</span>";
      const searchKey = ((f.path || "") + " " + (f.original || "")).toLowerCase();
      rowsHtml += '<div data-search="' + escHtml(searchKey) + '"><b class="d-index">[' + idx + "]</b> " + open + pathHtml(f.path) + close;
      if (f.original) {
        const origLink = Renderer.IdeLink.build(f.original, 0, ideConfig);
        const oopen = origLink ? '<a href="' + escHtml(origLink) + '">' : "<span>";
        const oclose = origLink ? "</a>" : "</span>";
        rowsHtml += " &lt;- " + oopen + pathHtml(f.original) + oclose;
      }
      rowsHtml += "</div>";
    });

    const searchValue = tabSearch.files || "";
    container.innerHTML =
      '<div class="d-files-toolbar"><div class="d-tab-search-wrap">' +
      '<input type="text" class="d-tab-search" data-role="search" placeholder="파일 경로 검색" value="' + escHtml(searchValue) + '">' +
      "</div></div>" +
      '<pre class="d-content">' + rowsHtml + "</pre>";

    function applyFilesSearch(term) {
      const t = (term || "").toLowerCase();
      container.querySelectorAll(".d-content > div").forEach((row) => {
        row.style.display = (!t || (row.dataset.search || "").includes(t)) ? "" : "none";
      });
    }
    applyFilesSearch(searchValue);

    const searchInput = container.querySelector(".d-tab-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        tabSearch.files = searchInput.value.trim();
        applyFilesSearch(tabSearch.files);
      });
    }
  }

  function formatMemory(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + "MB" : (bytes / 1024).toFixed(0) + "KB";
  }

  // 디테일 헤더 우측 컴팩트 요약 — meta.runtime / summary.time.total / summary.memory.usage 사용
  function buildHeaderSummary(data) {
    if (!data || data.schemaVersion !== 2) return "";
    const parts = [];
    const runtime = data.meta && data.meta.runtime;
    if (runtime && runtime.name) {
      const runtimeLabel = runtime.name === "php" ? "PHP" : runtime.name;
      parts.push(runtime.version ? runtimeLabel + " " + runtime.version : runtimeLabel);
    }
    if (typeof data.summary.time.total === "number") parts.push("T " + Math.round(data.summary.time.total * 1000) + "ms");
    if (typeof data.summary.memory.usage === "number") parts.push("M " + formatMemory(data.summary.memory.usage));
    return parts.join(" · ");
  }

  function renderDetail(entry) {
    updateTabCounts(entry);
    if (!entry) {
      detailHeaderMainEl.textContent = "요청을 선택하세요";
      detailHeaderSummaryEl.textContent = "";
      clearTabPanels();
      return;
    }
    detailHeaderMainEl.textContent = `${entry.method} ${entry.url} (${entry.status ?? "-"}) — ${entry.id}`;
    detailHeaderSummaryEl.textContent = buildHeaderSummary(entry.data);

    if (entry.retrying) {
      showMessage("재조회 중...");
    } else if (entry.error) {
      showMessage("조회 실패: " + entry.error + " (다시 선택하면 재시도)");
    } else if (entry.data === null) {
      showMessage("조회 중...");
    } else {
      clearTabPanels();
      renderActiveTab(entry);
    }
  }

  function switchTab(tab) {
    if (activeTab === tab) return;
    activeTab = tab;
    tabBarEl.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    Object.entries(tabPanels).forEach(([name, el]) => {
      el.classList.toggle("active", name === tab);
    });
    if (selectedEntry && selectedEntry.data) renderActiveTab(selectedEntry);
  }

  tabBarEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) switchTab(btn.dataset.tab);
  });

  // trace/Files 탭의 IDE 링크는 devtools 패널 컨텍스트에서 anchor 기본 동작(navigation)이 통하지 않아
  // 별도 가로채기가 필요하다 (devtools API 가 없는 preview 등에서는 기본 동작 그대로 유지됨).
  Renderer.IdeLink.installClickInterceptor(tabContentEl);

  function selectEntry(entry) {
    selectedEntry = entry;
    renderList();
    renderDetail(entry);
    if (entry && entry.error && !entry.retrying && shared) shared.retryFetch(entry);
  }

  // ------------------------------------------------------------
  // devtools.js 가 소유한 공유 상태(entries/상태 변경 알림) 를 주입받는다.
  // panel window 는 패널이 숨겨져도 유지되므로 devtools.js 가 윈도우당 최초 1회만 호출하는 게
  // 정상 경로지만, 브라우저별 window 식별 차이로 재호출될 수 있어 이전 구독을 항상 해제한다.
  // ------------------------------------------------------------

  let detachOnChange = null;

  window.__novaAttach = function (sharedState) {
    if (detachOnChange) {
      detachOnChange();
      detachOnChange = null;
    }

    shared = sharedState;
    entries = shared.entries;
    shared.setPreserveLog(preserveChk.checked);

    detachOnChange = shared.onChange(() => {
      setStatus(shared.getStatus());
      if (selectedEntry && entries.indexOf(selectedEntry) === -1) {
        selectedEntry = null;
      }
      refreshCaptureControl();
      renderList();
      renderDetail(selectedEntry);
    });

    setStatus(shared.getStatus());
    refreshCaptureControl();
    renderList();
    renderDetail(selectedEntry);
  };

  clearBtn.addEventListener("click", () => {
    if (shared) shared.clear();
  });

  // DevTools 패널 컨텍스트는 확장 API 접근이 제한적이라 runtime.openOptionsPage 가 없을 수 있어
  // 그 경우 background 에 위임한다.
  openOptionsBtn.addEventListener("click", () => {
    if (typeof ext.runtime.openOptionsPage === "function") {
      ext.runtime.openOptionsPage().catch((err) => {
        console.error("[NovaDebug] 옵션 페이지 열기 실패", err);
      });
      return;
    }
    ext.runtime.sendMessage({ type: NovaDebugProtocol.MSG.OPEN_OPTIONS }).catch((err) => {
      console.error("[NovaDebug] 옵션 페이지 열기 요청 실패", err);
    });
  });

  preserveChk.addEventListener("change", () => {
    if (shared) shared.setPreserveLog(preserveChk.checked);
  });

  filterInputEl.addEventListener("input", () => {
    filterText = filterInputEl.value.trim().toLowerCase();
    renderList();
  });

  // userTheme 이 auto 면 devtools 테마를 따르고, light/dark 면 강제 적용한다.
  function applyTheme() {
    const effective = userTheme === "auto" ? devtoolsThemeName : userTheme;
    document.documentElement.setAttribute("data-theme", effective === "dark" ? "dark" : "light");
  }
  applyTheme();

  // devtools 테마 실시간 반영 — Chrome/Firefox 는 API 형태가 달라 존재 여부로 감지한다.
  // 둘 다 없으면 최초 1회 반영(applyTheme 위 호출)만 유지된다.
  function onDevtoolsThemeChanged(themeName) {
    devtoolsThemeName = themeName;
    applyTheme();
  }
  if (typeof ext.devtools.panels.setThemeChangeHandler === "function") {
    ext.devtools.panels.setThemeChangeHandler(onDevtoolsThemeChanged);
  } else if (ext.devtools.panels.onThemeChanged && typeof ext.devtools.panels.onThemeChanged.addListener === "function") {
    ext.devtools.panels.onThemeChanged.addListener(onDevtoolsThemeChanged);
  }

  // ------------------------------------------------------------
  // 레이아웃 스플리터 — 요청 목록/상세 영역 폭을 드래그로 조절, storage.local 에 비율 영속화
  // ------------------------------------------------------------

  const SPLIT_STORAGE_KEY = "novaDebugSplitRatio";
  const SPLIT_MIN_RATIO = 0.2;
  const SPLIT_MAX_RATIO = 0.75;

  function applySplitRatio(ratio) {
    listEl.style.width = (ratio * 100) + "%";
  }

  function loadSplitRatio() {
    const area = ext.storage && ext.storage.local;
    if (!area) return;
    area
      .get(SPLIT_STORAGE_KEY)
      .then((res) => {
        const ratio = res && res[SPLIT_STORAGE_KEY];
        if (typeof ratio === "number" && ratio >= SPLIT_MIN_RATIO && ratio <= SPLIT_MAX_RATIO) {
          applySplitRatio(ratio);
        }
      })
      .catch(() => {});
  }

  function saveSplitRatio(ratio) {
    const area = ext.storage && ext.storage.local;
    if (!area) return;
    area.set({ [SPLIT_STORAGE_KEY]: ratio }).catch(() => {});
  }

  function setupSplitter() {
    if (!splitHandleEl || !mainEl) return;
    let dragging = false;

    splitHandleEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      splitHandleEl.classList.add("dragging");
      document.body.style.cursor = "col-resize";
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const rect = mainEl.getBoundingClientRect();
      let ratio = (e.clientX - rect.left) / rect.width;
      ratio = Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, ratio));
      applySplitRatio(ratio);
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      splitHandleEl.classList.remove("dragging");
      document.body.style.cursor = "";
      const ratio = parseFloat(listEl.style.width) / 100;
      if (!isNaN(ratio)) saveSplitRatio(ratio);
    });

    loadSplitRatio();
  }
  setupSplitter();

  renderList();
  renderDetail(null);
  loadHostMap().then(refreshCaptureControl);
  loadTheme();
  loadShowTime();
})();
