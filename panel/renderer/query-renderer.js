/*
 * Nova Debug — Queries 탭 렌더러
 * SQL 전문/EXPLAIN 나열이 아니라 Files 탭처럼 간결한 쿼리 목록(index/시간/테이블/한줄 요약)을 보여준다.
 * EXPLAIN 표시는 하지 않는다(원본 EXPLAIN 표시는 Dumps 탭 행 내부에서 유지). 목록 클릭 시 Dumps 탭의 해당
 * 행으로 이동+선택(opts.onSelect). 상단 [테이블별 | 순서기준] 토글은 원본 debug.js By Table 뷰 로직 참고.
 */
(function (root) {
  const NS = root.NovaDebugRenderer = root.NovaDebugRenderer || {};
  const escHtml = NS.escHtml;
  const SqlFormatter = NS.SqlFormatter;
  const RowRenderer = NS.RowRenderer;

  function buildStatsHtml(debugData) {
    const q = debugData.summary.queries;
    if (!q.count) return '';
    let html = '<div class="d-query-stats">';
    html += '<span class="d-stat-line">Total: <b>' + q.time + 's</b> / Count: <b>' + q.count + '</b> / Avg: <b>' + q.avg + 'ms</b> / Max: <b>' + q.max + 'ms</b> (idx:' + q.maxIndex + ')</span>';
    if (q.dup.patterns) {
      html += '<span class="d-stat-line">Duplicate: <b>' + q.dup.patterns + '</b> patterns, <b>' + q.dup.total + '</b> queries (' + q.dup.percent + '%)</span>';
    }
    if (q.loop.sites) {
      let loopDetail = '';
      if (q.loop.byType && q.loop.byType.length) {
        loopDetail = ' — ' + q.loop.byType.map((g) => g.table + ' x' + g.count).join(', ');
      }
      html += '<span class="d-stat-line">Loop: <b>' + q.loop.sites + '</b> sites, <b>' + q.loop.total + '</b> queries' + loopDetail + '</span>';
    }
    if (q.slow.count) {
      html += '<span class="d-stat-line">Slow (&gt;' + ((debugData.thresholds.slowQueryTime || 0) * 1000) + 'ms): <b>' + q.slow.count + '</b> queries (' + q.slow.time + 's)</span>';
    }
    html += '</div>';
    return html;
  }

  // query.bindings(prepared statement 파라미터)를 "[0] "abc", [1] 42" 류 컴팩트 텍스트로 표시. null은 NULL.
  function buildBindingsHtml(bindings) {
    const text = bindings.map((val, i) => {
      let display;
      if (val === null) display = 'NULL';
      else if (typeof val === 'string') display = '"' + val + '"';
      else display = String(val);
      return '[' + i + '] ' + display;
    }).join(', ');
    return '<span class="d-q-bindings-label">Bindings</span> <code>' + escHtml(text) + '</code>';
  }

  // 목록 한 줄 — index / 시간 / (커넥션) / (테이블) / 한줄 요약, bindings가 있으면 SQL 아래에 추가 표시.
  // showTable=false 는 테이블별 뷰에서 그룹 헤더가 테이블명을 대신 보여줄 때.
  function queryRowHtml(item, dataIdx, showTable, slowQueryThreshold) {
    const remark = item.duration > slowQueryThreshold ? 'd-remark' : '';
    const q = item.query || {};
    let html = '<div class="d-q-row ' + remark + '" data-didx="' + dataIdx + '">';
    html += '<div class="d-q-row-main">';
    html += '<b class="d-index">[' + item.index + ']</b>';
    html += '<span class="d-q-time">[' + item.duration.toFixed(5) + ']</span>';
    html += RowRenderer.queryBadges(item);
    if (q.connection) html += '<span class="d-badge d-connection">' + escHtml(q.connection) + '</span>';
    if (showTable) html += '<strong class="d-table">' + escHtml(q.table || '(unknown)') + '</strong>';
    html += '<span class="d-q-summary">' + SqlFormatter.simple(escHtml(SqlFormatter.truncateIn(item.dump))) + '</span>';
    html += '<button type="button" class="d-copy-btn" title="복사">📋</button>';
    html += '</div>';
    if (q.bindings && q.bindings.length) html += '<div class="d-q-bindings">' + buildBindingsHtml(q.bindings) + '</div>';
    html += '</div>';
    return html;
  }

  function buildOrderView(debugData, slowQueryThreshold) {
    let html = '';
    debugData.entries.forEach((item, i) => {
      if (item.type !== 'query') return;
      html += queryRowHtml(item, i, true, slowQueryThreshold);
    });
    return html || '<p class="d-empty-msg">쿼리가 없습니다.</p>';
  }

  // 원본 debug.js setupQueryList() 의 buildTableView 로직 참고 — 테이블명 기준 그룹핑 + 그룹별 합계 시간.
  function buildTableView(debugData, slowQueryThreshold) {
    const groups = {};
    const order = [];
    debugData.entries.forEach((item, i) => {
      if (item.type !== 'query') return;
      const table = item.query.table || '(unknown)';
      if (!groups[table]) { groups[table] = { items: [], totalTime: 0 }; order.push(table); }
      groups[table].items.push({ item, dataIdx: i });
      groups[table].totalTime += item.duration || 0;
    });
    if (!order.length) return '<p class="d-empty-msg">쿼리가 없습니다.</p>';

    let html = '';
    order.slice().sort((a, b) => a.localeCompare(b)).forEach((table) => {
      const group = groups[table];
      html += '<div class="d-table-group-header"><strong class="d-table">' + escHtml(table) + '</strong> ' +
        group.items.length + ' queries (' + group.totalTime.toFixed(5) + 's)</div>';
      group.items.forEach(({ item, dataIdx }) => {
        html += queryRowHtml(item, dataIdx, false, slowQueryThreshold);
      });
    });
    return html;
  }

  // 검색어(SQL 텍스트, item.dump 기준)와 일치하는 행만 표시. 테이블별 뷰의 그룹 헤더는
  // 그룹 내 표시 행이 하나도 없으면 함께 숨긴다.
  function applyQuerySearch(root, debugData, searchText) {
    const term = (searchText || '').toLowerCase();
    root.querySelectorAll('.d-q-row').forEach((row) => {
      if (!term) { row.style.display = ''; return; }
      const idx = parseInt(row.dataset.didx, 10);
      const item = debugData.entries[idx];
      const text = (item && item.dump ? item.dump : '').toLowerCase();
      row.style.display = text.includes(term) ? '' : 'none';
    });
    root.querySelectorAll('.d-table-group-header').forEach((header) => {
      let sib = header.nextElementSibling;
      let anyVisible = false;
      while (sib && !sib.classList.contains('d-table-group-header')) {
        if (sib.classList.contains('d-q-row') && sib.style.display !== 'none') anyVisible = true;
        sib = sib.nextElementSibling;
      }
      header.style.display = (!term || anyVisible) ? '' : 'none';
    });
  }

  /**
   * Queries 탭 렌더링.
   * @param {HTMLElement} container
   * @param {object} debugData
   * @param {{slowQueryThreshold:number, onSelect:function, searchText:string, onSearchChange:function}} opts
   */
  function renderQueriesTab(container, debugData, opts) {
    const slowQueryThreshold = opts.slowQueryThreshold;
    const searchText = opts.searchText || '';
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'd-queries-root';

    let html = '<div class="d-q-toolbar">';
    html += '<div class="d-q-view-toggle">' +
      '<button type="button" class="d-q-view-btn active" data-view="table">테이블별</button>' +
      '<button type="button" class="d-q-view-btn" data-view="order">순서기준</button>' +
      '</div>';
    html += '<div class="d-tab-search-wrap"><input type="text" class="d-tab-search" data-role="search" placeholder="SQL 검색" value="' + escHtml(searchText) + '"></div>';
    html += '</div>';
    html += buildStatsHtml(debugData);
    html += '<div class="d-content d-q-view-table">' + buildTableView(debugData, slowQueryThreshold) + '</div>';
    html += '<div class="d-content d-q-view-order" style="display:none">' + buildOrderView(debugData, slowQueryThreshold) + '</div>';
    root.innerHTML = html;
    container.appendChild(root);

    applyQuerySearch(root, debugData, searchText);

    const searchInput = root.querySelector('.d-tab-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim();
        if (typeof opts.onSearchChange === 'function') opts.onSearchChange(val);
        applyQuerySearch(root, debugData, val);
      });
    }

    root.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('.d-q-view-btn');
      if (viewBtn) {
        e.preventDefault();
        const view = viewBtn.dataset.view;
        root.querySelectorAll('.d-q-view-btn').forEach((b) => b.classList.toggle('active', b === viewBtn));
        root.querySelector('.d-q-view-order').style.display = view === 'order' ? '' : 'none';
        root.querySelector('.d-q-view-table').style.display = view === 'table' ? '' : 'none';
        return;
      }

      const copyBtn = e.target.closest('.d-copy-btn');
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const qRow = copyBtn.closest('.d-q-row');
        const idx = parseInt(qRow.dataset.didx, 10);
        const item = debugData.entries[idx];
        if (item) RowRenderer.copyItem(copyBtn, item);
        return;
      }

      const qRow = e.target.closest('.d-q-row');
      if (!qRow) return;
      e.preventDefault();
      const idx = parseInt(qRow.dataset.didx, 10);
      const item = debugData.entries[idx];
      if (item && typeof opts.onSelect === 'function') opts.onSelect(item.index);
    });
  }

  NS.QueryRenderer = { renderQueriesTab };
})(typeof self !== 'undefined' ? self : this);
