/*
 * Nova Debug — Dumps 탭 렌더러 (Nova/debug/assets/debug.js renderRow/buildTraceHtml 이식)
 * data[] 전체 항목을 표시한다 (쿼리 포함). Queries 탭은 query-renderer.js 가 별도로 필터링해 보여준다.
 * PIN 은 별도 탭 없이 Dumps 툴바의 PIN 필터 칩(opts.isPinned() 로 필터)으로 통합되어 있다.
 */
(function (root) {
  const NS = root.NovaDebugRenderer = root.NovaDebugRenderer || {};
  const escHtml = NS.escHtml;
  const SqlFormatter = NS.SqlFormatter;
  const IdeLink = NS.IdeLink;

  function queryBadges(item) {
    const q = item.query || {};
    let badges = '';
    if (q.loop && q.loop.count > 1) badges += '<button type="button" class="d-badge d-loop" data-group="' + escHtml(q.loop.group) + '">LOOP x' + q.loop.count + '</button>';
    if (q.dup && q.dup.count > 1) badges += '<button type="button" class="d-badge d-dup" data-group="' + escHtml(q.dup.group) + '">DUP x' + q.dup.count + '</button>';
    return badges;
  }

  // EXPLAIN 렌더 — query.explain(정식 필드, 3-format) 우선, 없으면 explainHtml(deprecated) 폴백,
  // 둘 다 없으면 기존 동작(공백 1개, "이 항목은 쿼리다" 신호 겸용 — SCHEMA.md §7)을 유지한다.
  function buildExplainHtml(query) {
    const explain = query && query.explain;
    if (explain) {
      if (explain.format === 'table') {
        let html = '<table><thead><tr>';
        (explain.columns || []).forEach((col) => { html += '<th>' + escHtml(String(col)) + '</th>'; });
        html += '</tr></thead><tbody>';
        (explain.rows || []).forEach((row) => {
          html += '<tr>';
          row.forEach((cell) => {
            const text = (cell === null || cell === undefined) ? 'NULL' : String(cell);
            html += '<td>' + escHtml(text) + '</td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
      }
      if (explain.format === 'text') {
        return '<pre class="d-explain-text">' + escHtml(explain.text || '') + '</pre>';
      }
      if (explain.format === 'json') {
        return '<pre class="d-explain-text">' + escHtml(JSON.stringify(explain.json, null, 2)) + '</pre>';
      }
    }
    return (query && query.explainHtml) || ' ';
  }

  // type=array/object 항목의 "종류 : 개수" 표시 문자열 — v1은 구조화 필드(array{depth,count}/object{className,count})로
  // 오므로 v0의 문자열 인코딩("array : 8" 등)을 여기서 재조립한다 (SCHEMA.md §5).
  function entryTypeLabel(item) {
    if (item.type === 'array') {
      return 'array : ' + item.array.count;
    }
    if (item.type === 'dump' && item.object) {
      return item.object.className + (item.object.count !== undefined && item.object.count !== null ? ' : ' + item.object.count : '');
    }
    return '';
  }

  // frames[]/files[] 인덱스를 실제 파일 경로/라인/함수 정보로 해석한다. 표시용 호출 번호는
  // trace.length - position 으로 1부터 매긴다(SCHEMA.md §6 "호출 번호 표시" 참조).
  function resolveFrame(frameIdx, data) {
    const frame = (data.frames || [])[frameIdx];
    if (!frame) return { file: null, line: 0, func: '', args: '', argsFull: '' };
    const fileEntry = (frame.file !== null && frame.file !== undefined) ? (data.files || [])[frame.file] : null;
    return {
      file: fileEntry ? fileEntry.path : null,
      line: frame.line,
      func: frame.func,
      args: frame.args,
      argsFull: frame.argsFull,
    };
  }

  function resolveTrace(item, data) {
    const idxList = item.trace || [];
    return idxList.map((frameIdx, pos) => {
      const resolved = resolveFrame(frameIdx, data);
      resolved.idx = idxList.length - pos;
      return resolved;
    });
  }

  // 쿼리 행은 포맷된 SQL(plain text), 일반 dump 행은 메시지(label) + 데이터(dump)를 복사 대상으로 삼는다.
  // item 객체에서 직접 추출하므로 지연 렌더(d-lazy/ensureDeferred) 여부와 무관하게 항상 완전한 값을 얻는다.
  function buildCopyText(item) {
    if (item.type === 'query') return SqlFormatter.format(item.dump || '');
    const parts = [];
    if (item.label) parts.push(item.label);
    if (item.dump) parts.push(item.dump);
    return parts.join('\n');
  }

  // Clipboard API 미지원/거부 시 textarea+execCommand 폴백 (구버전 Firefox 등 대비)
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('execCommand copy failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function flashCopyBtn(btn) {
    const original = btn.textContent;
    btn.classList.add('d-copy-done');
    btn.textContent = '✓';
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('d-copy-done');
    }, 1200);
  }

  // 행 복사 버튼(Dumps/Queries 공용) 클릭 처리
  function copyItem(btn, item) {
    copyToClipboard(buildCopyText(item)).then(() => flashCopyBtn(btn)).catch((err) => {
      console.error('[NovaDebug] copy failed', err);
    });
  }

  function buildTraceHtml(item, ideConfig, data) {
    let html = '';
    resolveTrace(item, data).forEach((trace, traceIdx) => {
      html += '<span>' + trace.idx + '.</span>';
      if (trace.file) {
        const link = IdeLink.build(trace.file, trace.line, ideConfig);
        const open = link ? '<a href="' + escHtml(link) + '">' : '<span>';
        const close = link ? '</a>' : '</span>';
        html += '<span>' + open + escHtml(trace.file) + ':<b>' + trace.line + '</b>' + close + '</span>';
        html += '<span>' + open + escHtml(trace.func) + close;
      } else {
        html += '<span>-</span>';
        html += '<span>' + escHtml(trace.func);
      }
      if (trace.args) {
        html += ' <b>(</b> ';
        if (trace.argsFull) html += '<a class="d-args" data-trace="' + item.index + '-' + traceIdx + '" href="#">';
        html += '<code>' + escHtml(trace.args) + '</code>';
        if (trace.argsFull) html += '</a>';
        html += ' <b>)</b>';
      }
      html += '</span>\n';
    });
    return html;
  }

  function renderRow(item, opts) {
    const slowQueryThreshold = opts.slowQueryThreshold;
    const tooManyCount = opts.tooManyCount;
    const ideConfig = opts.ideConfig;
    const typeLabel = entryTypeLabel(item);

    const labelClass = (item.label && /ERROR|Exception/i.test(item.label)) ? ' d-error'
      : (item.label && /REDIRECT/i.test(item.label)) ? ' d-redirect' : '';
    let remark = '';
    let text = '';
    let hasData = false;

    if (item.type === 'query') {
      const q = item.query || {};
      remark = item.duration > slowQueryThreshold ? 'd-remark' : '';
      text = queryBadges(item) +
        '<strong class="d-table">' + escHtml(q.table) + '</strong> ' +
        '[' + item.duration.toFixed(5) + ']' + SqlFormatter.pretty(SqlFormatter.truncateIn(item.dump));
    } else if (typeLabel) {
      if (item.array) {
        const threshold = (item.array.depth >= 2) ? tooManyCount : tooManyCount * 2;
        remark = (item.array.count >= threshold) ? 'd-remark' : '';
      }
      hasData = !!item.dump;
    } else if (item.type !== 'dump') {
      // 알려진 타입(dump/query/array) 외 generic 렌더 — log/exception 도 전용 렌더(E2) 전까지 이 경로를 탄다.
      // 미지 서브객체(item.type 과 동일한 이름의 키, 예: cache{})는 SCHEMA.md §5 소비 규칙에 따라 무시한다.
      text = '<span class="d-badge d-type-generic">' + escHtml(item.type) + '</span>' + escHtml(item.dump);
    } else {
      text = escHtml(item.dump);
    }

    const hasTrace = item.trace && item.trace.length > 0;
    const singleTrace = (!hasTrace || item.trace.length <= 1) ? 'single' : '';
    const traceClass = 'd-trace' + (!hasTrace ? ' d-empty' : '');
    const typeBtn = hasData
      ? '<button type="button" class="d-type-btn" data-deferred="1">' + escHtml(typeLabel) + '</button>'
      : (typeLabel ? '<button type="button" class="d-type-btn">' + escHtml(typeLabel) + '</button>' : '');
    const truncatedBadge = item.truncated ? '<span class="d-badge d-truncated" title="dump가 생산자 측에서 truncate됨">TRUNCATED</span>' : '';

    return '<div class="d-row-summary ' + remark + '">' +
        '<b class="d-index">[' + item.index + ']</b>' +
        '<span class="d-label' + labelClass + '">' + escHtml(item.label) + '</span>' +
        typeBtn +
        truncatedBadge +
        '<span class="d-row-text">' + text + '</span>' +
        '<button type="button" class="d-copy-btn" title="복사">📋</button>' +
      '</div>' +
      (item.type === 'query' ? '<div class="d-query-info">' + buildExplainHtml(item.query) + '</div>' : '') +
      '<pre class="d-dump"></pre>' +
      '<div class="' + traceClass + '">' +
        '<button type="button" class="d-trace-toggle ' + singleTrace + '" data-deferred="1"></button>' +
        '<div class="d-trace-data"></div>' +
      '</div>';
  }

  function ensureDeferred(row, item, opts) {
    const typeBtn = row.querySelector('.d-type-btn[data-deferred]');
    if (typeBtn) {
      const dumpEl = row.querySelector('.d-dump');
      if (dumpEl && item.dump) dumpEl.textContent = item.dump;
      delete typeBtn.dataset.deferred;
    }
    const traceToggle = row.querySelector('.d-trace-toggle[data-deferred]');
    if (traceToggle) {
      const traceData = row.querySelector('.d-trace-data');
      if (traceData) traceData.innerHTML = buildTraceHtml(item, opts.ideConfig, opts.data);
      delete traceToggle.dataset.deferred;
    }
  }

  /**
   * 행 클릭(= PIN 토글, trace on/off 겸용) / +- (trace 펼치기-접기) / type-btn(dump on/off) 위임 처리.
   * container 는 매 렌더마다 새로 생성된 요소여야 리스너가 누적되지 않는다
   * (재렌더 시 기존 컨테이너를 버리고 새 요소를 붙이는 방식).
   */
  function attachRowEvents(container, debugData, opts) {
    container.addEventListener('click', (e) => {
      const target = e.target;

      if (target.matches('.d-type-btn')) {
        e.preventDefault();
        const row = target.closest('.d-row');
        const item = debugData.entries[parseInt(row.dataset.didx, 10)];
        if (target.dataset.deferred) ensureDeferred(row, item, opts);
        const dumpEl = row.querySelector('.d-dump');
        if (dumpEl) dumpEl.classList.toggle('show');
        return;
      }

      if (target.matches('.d-copy-btn')) {
        e.preventDefault();
        e.stopPropagation();
        const row = target.closest('.d-row');
        const item = debugData.entries[parseInt(row.dataset.didx, 10)];
        copyItem(target, item);
        return;
      }

      const argsEl = target.closest('.d-args');
      if (argsEl) {
        e.preventDefault();
        const ids = argsEl.dataset.trace.split('-');
        const item = debugData.entries.find((d) => d.index === parseInt(ids[0], 10));
        const trace = item && resolveTrace(item, debugData)[parseInt(ids[1], 10)];
        if (trace) {
          let full = argsEl.parentNode.querySelector('.d-args-full');
          if (full) {
            full.remove();
          } else {
            full = document.createElement('pre');
            full.className = 'd-args-full';
            full.textContent = trace.argsFull;
            argsEl.insertAdjacentElement('afterend', full);
          }
        }
        return;
      }

      if (target.matches('.d-trace-toggle')) {
        e.preventDefault();
        const row = target.closest('.d-row');
        const item = debugData.entries[parseInt(row.dataset.didx, 10)];
        if (target.dataset.deferred) ensureDeferred(row, item, opts);
        target.classList.toggle('on');
        return;
      }

      // 행(.d-row-summary) 클릭 = PIN 토글(trace 표시 on/off + border 겸용, +/- 트레이스 펼치기와는 별개 — 원본 helpers.pin 동작)
      const summary = target.closest('.d-row-summary');
      if (summary) {
        const row = summary.parentNode;
        const item = debugData.entries[parseInt(row.dataset.didx, 10)];
        if (row.classList.contains('d-lazy')) {
          row.innerHTML = renderRow(item, opts);
          row.classList.remove('d-lazy');
          if (opts._observer) opts._observer.unobserve(row);
        }
        const nowPinned = typeof opts.onTogglePin === 'function' ? opts.onTogglePin(item.index) : !row.classList.contains('on');
        row.classList.toggle('on', nowPinned);
        // on 전환 시 trace/dump deferred 콘텐츠를 즉시 채운다 — 비워두면 trace 영역이 표시만 되고 내용이 없다
        if (nowPinned) ensureDeferred(row, item, opts);
        const root = container.closest('.d-dumps-root');
        if (root) refreshPinChip(root, container, debugData, opts);
      }
    });
  }

  function pinnedCount(debugData, opts) {
    if (!opts.isPinned) return 0;
    let n = 0;
    debugData.entries.forEach((item) => { if (opts.isPinned(item.index)) n++; });
    return n;
  }

  // Dumps 탭 툴바 — PIN/LOOP/DUP/SLOW 카운트 칩 + 우측 검색 입력. 칩 클릭 시 해당 조건에 맞는 행만
  // 필터링(토글)하고, 검색어는 칩 필터와 AND 결합된다. 행 내 기존 뱃지는 그대로 유지.
  // PIN·SLOW 는 개수가 0이어도 항상 표시하되(d-filter-chip-empty 로 회색 비활성 표시) LOOP/DUP 는 원본처럼 개수 있을 때만 표시한다.
  function buildFilterToolbarHtml(debugData, pinCount, searchText) {
    const loopN = debugData.summary.queries.loop.total || 0;
    const dupN = debugData.summary.queries.dup.total || 0;
    const slowN = debugData.summary.queries.slow.count || 0;
    const pinEmpty = pinCount ? '' : ' d-filter-chip-empty';
    const slowEmpty = slowN ? '' : ' d-filter-chip-empty';
    let html = '<div class="d-dumps-toolbar">';
    html += '<button type="button" class="d-filter-chip d-filter-pin' + pinEmpty + '" data-filter="pin">PIN ' + pinCount + '</button>';
    html += '<button type="button" class="d-filter-chip d-pin-reset' + pinEmpty + '">PIN reset</button>';
    if (loopN) html += '<button type="button" class="d-filter-chip d-filter-loop" data-filter="loop">LOOP ' + loopN + '</button>';
    if (dupN) html += '<button type="button" class="d-filter-chip d-filter-dup" data-filter="dup">DUP ' + dupN + '</button>';
    html += '<button type="button" class="d-filter-chip d-filter-slow' + slowEmpty + '" data-filter="slow">SLOW ' + slowN + '</button>';
    html += '<div class="d-tab-search-wrap"><input type="text" class="d-tab-search" data-role="search" placeholder="검색 (label/내용)" value="' + escHtml(searchText || '') + '"></div>';
    html += '</div>';
    return html;
  }

  // 칩 필터(opts._filterType)와 검색어(opts._searchText)를 AND 결합해 표시 여부를 판정한다.
  // 원본 debug.js applyFilter() 의 slow 판정과 동일: item.duration >= slowQueryThreshold
  function applyDumpsFilter(rowsEl, debugData, opts) {
    const filterType = opts._filterType || null;
    const searchText = opts._searchText || '';
    rowsEl.querySelectorAll('.d-row').forEach((row) => {
      const item = debugData.entries[parseInt(row.dataset.didx, 10)];
      let show = true;
      if (filterType && item) {
        const q = item.query || {};
        if (filterType === 'loop') show = !!(q.loop && q.loop.count > 1);
        else if (filterType === 'dup') show = !!(q.dup && q.dup.count > 1);
        else if (filterType === 'pin') show = !!(opts.isPinned && opts.isPinned(item.index));
        else if (filterType === 'slow') show = item.duration >= opts.slowQueryThreshold;
      }
      if (show && searchText && item) {
        const haystack = ((item.label || '') + ' ' + (item.dump || '')).toLowerCase();
        show = haystack.includes(searchText);
      }
      row.style.display = show ? '' : 'none';
    });
  }

  // PIN 칩 카운트/비활성 표시 갱신. pinned 가 0이 되었는데 PIN 필터가 활성 상태면 자동 해제(빈 화면 방지).
  function refreshPinChip(root, rowsEl, debugData, opts) {
    const chip = root.querySelector('.d-filter-pin');
    const resetBtn = root.querySelector('.d-pin-reset');
    const count = pinnedCount(debugData, opts);
    if (chip) {
      chip.textContent = 'PIN ' + count;
      chip.classList.toggle('d-filter-chip-empty', !count);
      if (!count && chip.classList.contains('on')) {
        chip.classList.remove('on');
        opts._filterType = null;
        applyDumpsFilter(rowsEl, debugData, opts);
      }
    }
    if (resetBtn) resetBtn.classList.toggle('d-filter-chip-empty', !count);
  }

  /**
   * Dumps 탭 렌더링 — container 에 debugData.entries 전체를 행으로 표시한다.
   * @param {HTMLElement} container
   * @param {object} debugData
   * @param {{slowQueryThreshold:number, tooManyCount:number, ideConfig:object, isPinned:function, onTogglePin:function}} opts
   */
  function renderDumpsTab(container, debugData, opts) {
    opts._filterType = null;
    opts._searchText = (opts.searchText || '').toLowerCase();
    opts.data = debugData; // frames[]/files[] 해석용(resolveTrace) — buildTraceHtml 등에서 참조

    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'd-dumps-root';
    root.innerHTML = buildFilterToolbarHtml(debugData, pinnedCount(debugData, opts), opts.searchText);

    const rowsEl = document.createElement('div');
    rowsEl.className = 'd-dumps-rows';
    root.appendChild(rowsEl);
    container.appendChild(root);

    const fragment = document.createDocumentFragment();
    const canObserve = typeof IntersectionObserver !== 'undefined';
    let observer = null;
    if (canObserve) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const el = entry.target;
          if (!entry.isIntersecting || !el.classList.contains('d-lazy')) return;
          const idx = parseInt(el.dataset.didx, 10);
          const item = debugData.entries[idx];
          el.innerHTML = renderRow(item, opts);
          el.classList.remove('d-lazy');
          if (el.classList.contains('on')) ensureDeferred(el, item, opts);
          observer.unobserve(el);
        });
      }, { rootMargin: '300px' });
    }
    opts._observer = observer;

    debugData.entries.forEach((item, i) => {
      const row = document.createElement('div');
      row.id = 'd-row-' + item.index;
      const pinned = !!(opts.isPinned && opts.isPinned(item.index));
      row.className = 'd-row' + (canObserve ? ' d-lazy' : '') + (pinned ? ' on' : '');
      row.dataset.didx = i;
      if (canObserve) {
        observer.observe(row);
      } else {
        row.innerHTML = renderRow(item, opts);
        if (pinned) ensureDeferred(row, item, opts);
      }
      fragment.appendChild(row);
    });
    rowsEl.appendChild(fragment);

    attachRowEvents(rowsEl, debugData, opts);

    if (opts._searchText) applyDumpsFilter(rowsEl, debugData, opts);

    root.addEventListener('click', (e) => {
      const resetBtn = e.target.closest('.d-pin-reset');
      if (resetBtn) {
        e.preventDefault();
        if (!pinnedCount(debugData, opts)) return;
        debugData.entries.forEach((item) => {
          if (opts.isPinned && opts.isPinned(item.index)) {
            opts.onTogglePin(item.index);
            const row = rowsEl.querySelector('#d-row-' + item.index);
            if (row) row.classList.remove('on');
          }
        });
        root.querySelectorAll('.d-filter-chip.d-filter-pin').forEach((c) => c.classList.remove('on'));
        opts._filterType = null;
        applyDumpsFilter(rowsEl, debugData, opts);
        refreshPinChip(root, rowsEl, debugData, opts);
        return;
      }

      const chip = e.target.closest('.d-filter-chip[data-filter]');
      if (!chip) return;
      e.preventDefault();
      if (chip.classList.contains('d-filter-chip-empty') && !chip.classList.contains('on')) return;
      const turningOn = !chip.classList.contains('on');
      root.querySelectorAll('.d-filter-chip[data-filter]').forEach((c) => c.classList.remove('on'));
      const filterType = turningOn ? chip.dataset.filter : null;
      if (filterType) chip.classList.add('on');
      opts._filterType = filterType;
      applyDumpsFilter(rowsEl, debugData, opts);
    });

    const searchInput = root.querySelector('.d-tab-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim();
        opts._searchText = val.toLowerCase();
        if (typeof opts.onSearchChange === 'function') opts.onSearchChange(val);
        applyDumpsFilter(rowsEl, debugData, opts);
      });
    }
  }

  NS.RowRenderer = { renderRow, queryBadges, buildTraceHtml, renderDumpsTab, buildCopyText, copyToClipboard, flashCopyBtn, copyItem, resolveTrace, entryTypeLabel };
})(typeof self !== 'undefined' ? self : this);
