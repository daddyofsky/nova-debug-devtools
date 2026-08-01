/*
 * Nova Debug — 렌더러 프리뷰 (devtools 없이 파일로 열어 검증)
 * fixtures/sample.json 을 불러와 panel.js 와 동일한 탭 렌더링 로직을 재현한다.
 */
(function () {
  const Renderer = window.NovaDebugRenderer;
  const statusEl = document.getElementById("status");
  const detailHeaderMainEl = document.getElementById("detail-header-main");
  const detailHeaderSummaryEl = document.getElementById("detail-header-summary");
  const tabBarEl = document.getElementById("tab-bar");
  const tabContentEl = document.getElementById("tab-content");
  const tabPanels = {
    dumps: document.getElementById("tab-dumps"),
    queries: document.getElementById("tab-queries"),
    timeline: document.getElementById("tab-timeline"),
    files: document.getElementById("tab-files"),
    raw: document.getElementById("tab-raw"),
  };

  // preview 는 devtools 요청 단위가 없으므로 단일 인메모리 Set 으로 PIN 상태를 유지한다.
  const pinnedSet = new Set();
  // 탭별 독립 검색어 — panel.js 와 동일한 정책
  const tabSearch = { dumps: "", queries: "", files: "" };

  // 실제 IDE 매핑 없이도 링크 생성 로직을 눈으로 확인할 수 있도록 이 저장소 경로를 데모로 사용.
  const DEMO_IDE_CONFIG = {
    protocol: "phpstorm",
    localPath: "/Volumes/DATA/work/src/nova_builder",
    project: "nova_builder",
  };

  let activeTab = "dumps";
  let data = null;

  function setTabCount(tab, count) {
    const el = tabBarEl.querySelector('.tab-btn[data-tab="' + tab + '"] .tab-count');
    if (el) el.textContent = (count === null || count === undefined) ? "" : String(count);
  }

  function updateTabCounts(d) {
    setTabCount("dumps", d.entries.length);
    setTabCount("queries", d.summary.queries.count);
    setTabCount("files", d.summary.files.count);
  }

  function clearTabPanels() {
    Object.values(tabPanels).forEach((el) => {
      el.innerHTML = "";
    });
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

  function formatMemory(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + "MB" : (bytes / 1024).toFixed(0) + "KB";
  }

  // x-nova.fileHighlight 색상명은 CSS 클래스로 쓰이므로 팔레트에 있는 이름만 허용한다 — panel.js 와 동일
  const FILE_HIGHLIGHT_COLORS = new Set([
    "blue", "green", "orange", "red", "purple", "teal", "pink", "brown", "gray", "black",
  ]);

  function renderFilesTab(container, d, ideConfig) {
    const escHtml = Renderer.escHtml;
    const fileHighlight = (d["x-nova"] && d["x-nova"].fileHighlight) || null;
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
    (d.files || []).forEach((f, idx) => {
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

  // 디테일 헤더 우측 컴팩트 요약 — panel.js 와 동일 로직
  function buildHeaderSummary(d) {
    if (!d || d.schemaVersion !== 2) return "";
    const parts = [];
    const runtime = d.meta && d.meta.runtime;
    if (runtime && runtime.name) {
      const runtimeLabel = runtime.name === "php" ? "PHP" : runtime.name;
      parts.push(runtime.version ? runtimeLabel + " " + runtime.version : runtimeLabel);
    }
    if (typeof d.summary.time.total === "number") parts.push("T " + Math.round(d.summary.time.total * 1000) + "ms");
    if (typeof d.summary.memory.usage === "number") parts.push("M " + formatMemory(d.summary.memory.usage));
    return parts.join(" · ");
  }

  function renderActiveTab() {
    const opts = {
      slowQueryThreshold: (data.thresholds && data.thresholds.slowQueryTime) || 0,
      tooManyCount: (data.thresholds && data.thresholds.tooManyCount) || 0,
      ideConfig: DEMO_IDE_CONFIG,
      data, // frames[]/files[] 해석(resolveTrace 등)을 위해 렌더러에 원본 v1 페이로드를 전달
      onSelect: selectRowInDumps,
      isPinned: (idx) => pinnedSet.has(idx),
      onTogglePin: (idx) => {
        if (pinnedSet.has(idx)) pinnedSet.delete(idx);
        else pinnedSet.add(idx);
        return pinnedSet.has(idx);
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
      renderFilesTab(tabPanels.files, data, DEMO_IDE_CONFIG);
    } else if (activeTab === "raw") {
      Renderer.JsonView.render(tabPanels.raw, data);
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
    if (data) renderActiveTab();
  }

  tabBarEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) switchTab(btn.dataset.tab);
  });

  // preview 는 devtools API 가 없으므로 기존 anchor 기본 동작이 그대로 유지된다.
  Renderer.IdeLink.installClickInterceptor(tabContentEl);

  // fixtures/sample.js·fixtures/fixtures.js 가 <script> 로 먼저 로드되어 데이터를 심어둔다.
  // file:// 로 직접 열 때 fetch()의 CORS 제약을 피하기 위해 JSON 대신 스크립트 로드 방식을 쓴다.
  // ?fixture=<name> 으로 sample 외 픽스처(unknown-type/explain-formats/log-exception 등)를 선택할 수 있다.
  try {
    const fixtureName = new URLSearchParams(location.search).get("fixture") || "sample";
    data = fixtureName === "sample" ? window.__novaDebugSample : (window.__novaDebugFixtures || {})[fixtureName];
    if (!data) throw new Error("픽스처를 찾을 수 없습니다: " + fixtureName);
    const uri = (data.meta.request && data.meta.request.uri) || "(no uri)";
    detailHeaderMainEl.textContent = uri + " — " + data.meta.id;
    detailHeaderSummaryEl.textContent = buildHeaderSummary(data);
    statusEl.textContent = "loaded (schemaVersion " + data.schemaVersion + ")";
    updateTabCounts(data);
    clearTabPanels();
    renderActiveTab();
  } catch (err) {
    detailHeaderMainEl.textContent = "샘플 데이터 로드 실패";
    statusEl.textContent = String(err.message || err);
    console.error("[NovaDebug preview]", err);
  }
})();
