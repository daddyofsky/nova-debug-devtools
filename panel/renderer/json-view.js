/*
 * Nova Debug — Raw 탭 JSON 트리 뷰어
 * JSON.stringify 텍스트 그대로 출력하는 대신 값 타입별 하이라이트와 object/array
 * 접기/펼치기를 제공한다. 대용량 데이터 성능을 위해 depth 2 이상은 기본 접힘 상태로 렌더링한다
 * (펼침은 CSS 토글이라 재렌더 없이 즉시 반응한다).
 */
(function (root) {
  const NS = root.NovaDebugRenderer = root.NovaDebugRenderer || {};
  const escHtml = NS.escHtml;

  const DEFAULT_COLLAPSE_DEPTH = 2;

  function summaryText(value, isArray) {
    const count = isArray ? value.length : Object.keys(value).length;
    return isArray ? '[…] ' + count + ' items' : '{…} ' + count + ' keys';
  }

  function renderPrimitive(value) {
    if (value === null || value === undefined) return '<span class="d-json-null">null</span>';
    switch (typeof value) {
      case 'string':
        return '<span class="d-json-string">"' + escHtml(value) + '"</span>';
      case 'number':
        return '<span class="d-json-number">' + value + '</span>';
      case 'boolean':
        return '<span class="d-json-boolean">' + value + '</span>';
      default:
        return '<span class="d-json-null">null</span>';
    }
  }

  function isContainer(value) {
    return value !== null && typeof value === 'object';
  }

  // key가 null이면 배열 원소(키 라벨 없음). depth는 루트=0.
  function buildNode(key, value, depth) {
    const keyHtml = key !== null
      ? '<span class="d-json-key">"' + escHtml(key) + '"</span><span class="d-json-punct">: </span>'
      : '';

    if (!isContainer(value)) {
      return '<div class="d-json-line">' + keyHtml + renderPrimitive(value) + '</div>';
    }

    const isArray = Array.isArray(value);
    const entries = isArray ? value.map((v, i) => [null, v]) : Object.keys(value).map((k) => [k, value[k]]);
    const openBr = isArray ? '[' : '{';
    const closeBr = isArray ? ']' : '}';

    if (!entries.length) {
      return '<div class="d-json-line">' + keyHtml + '<span class="d-json-punct">' + openBr + closeBr + '</span></div>';
    }

    const collapsed = depth >= DEFAULT_COLLAPSE_DEPTH;
    let html = '<div class="d-json-node' + (collapsed ? ' d-json-collapsed' : '') + '">';
    html += '<div class="d-json-line d-json-toggle-line">';
    html += '<button type="button" class="d-json-toggle">' + (collapsed ? '▸' : '▾') + '</button>';
    html += keyHtml + '<span class="d-json-punct">' + openBr + '</span>';
    html += '<span class="d-json-summary">' + summaryText(value, isArray) + '</span>';
    html += '</div>';
    html += '<div class="d-json-children">';
    entries.forEach(([k, v]) => {
      html += buildNode(k, v, depth + 1);
    });
    html += '</div>';
    html += '<div class="d-json-line d-json-close-line"><span class="d-json-punct">' + closeBr + '</span></div>';
    html += '</div>';
    return html;
  }

  function render(container, data) {
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'd-json-root';
    root.innerHTML =
      '<div class="d-json-toolbar"><button type="button" class="d-copy-btn d-copy-btn-static" title="전체 복사">📋 전체 복사</button></div>' +
      buildNode(null, data, 0);
    container.appendChild(root);

    root.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.d-copy-btn');
      if (copyBtn) {
        e.preventDefault();
        // row-renderer.js 로드 순서에 의존하지 않도록 호출 시점에 NS.RowRenderer 를 참조한다.
        const RowRenderer = NS.RowRenderer;
        if (!RowRenderer || !RowRenderer.copyToClipboard) return;
        RowRenderer.copyToClipboard(JSON.stringify(data, null, 2)).then(() => {
          if (RowRenderer.flashCopyBtn) RowRenderer.flashCopyBtn(copyBtn);
        }).catch((err) => console.error('[NovaDebug] copy failed', err));
        return;
      }

      const btn = e.target.closest('.d-json-toggle');
      if (!btn) return;
      e.preventDefault();
      const node = btn.closest('.d-json-node');
      if (!node) return;
      const collapsed = node.classList.toggle('d-json-collapsed');
      btn.textContent = collapsed ? '▸' : '▾';
    });
  }

  NS.JsonView = { render };
})(typeof self !== 'undefined' ? self : this);
