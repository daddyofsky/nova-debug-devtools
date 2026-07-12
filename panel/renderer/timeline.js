/*
 * Nova Debug — Timeline 탭 렌더러 (Nova/debug/assets/debug.js timeline 로직 참고)
 * zoom 패널은 제거하고(스플리터로 영역 확대 + hover 레이어가 상세 확인을 대체) 대신:
 *  - 겹치는 쿼리 아이템은 grid-auto-flow:dense 다중 행(레인)에 배치해 서로 가리지 않게 한다.
 *  - 아이템 hover 시 SQL 한줄 하이라이트 + 시간을 레이어(툴팁)로 보여준다.
 *  - TIME 단계(timeline[])는 배경색 + 단계명을 항상 표시한다. left/width(%)는 summary.time.total 로 계산.
 */
(function (root) {
  const NS = root.NovaDebugRenderer = root.NovaDebugRenderer || {};
  const escHtml = NS.escHtml;
  const SqlFormatter = NS.SqlFormatter;

  function speedClass(duration, threshold) {
    if (duration >= threshold) return 'd-q-slow';
    if (duration >= threshold / 10) return 'd-q-mid';
    return '';
  }

  /**
   * 겹치는 아이템을 서로 다른 레인(행)에 배치 — 시작 위치(tl_left) 기준 그리디 구간 스케줄링.
   * 각 레인은 "마지막으로 배치된 아이템의 끝 위치"를 기억해두고, 그 끝보다 뒤에서 시작하는
   * 아이템만 같은 레인에 이어붙인다. 겹치면 새 레인(또는 비어있는 다른 레인)에 배치한다.
   * @param {Array} items tl_left/tl_width 를 가진 항목 배열(시작 위치 오름차순 정렬 안 되어 있어도 됨)
   * @returns {Array<{item:object, lane:number}>}
   */
  function assignLanes(items) {
    const sorted = items.slice().sort((a, b) => a.tl_left - b.tl_left);
    const laneEnds = [];
    return sorted.map((item) => {
      const start = item.tl_left;
      const end = item.tl_left + item.tl_width;
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      return { item, lane };
    });
  }

  function buildTooltipHtml(item) {
    let head = '[' + item.index + '] ' + item.duration.toFixed(5) + 's';
    if (item.query && item.query.table) head += '  ' + escHtml(item.query.table);
    const sql = item.dump ? SqlFormatter.simple(escHtml(SqlFormatter.truncateIn(item.dump))) : '';
    return '<div class="d-tl-tip-head">' + head + '</div>' + sql;
  }

  // 툴팁을 아이템 바로 아래, wrap 영역을 벗어나지 않게 배치
  function positionTooltip(tipEl, anchorEl, wrapEl) {
    const wrapRect = wrapEl.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    tipEl.style.display = 'block';
    const tipWidth = tipEl.offsetWidth;
    let left = (anchorRect.left - wrapRect.left) + anchorRect.width / 2 - tipWidth / 2;
    const maxLeft = wrapRect.width - tipWidth - 4;
    if (left > maxLeft) left = maxLeft;
    if (left < 4) left = 4;
    tipEl.style.left = left + 'px';
    tipEl.style.top = (anchorRect.bottom - wrapRect.top + 4) + 'px';
  }

  /**
   * Timeline 탭 렌더링.
   * @param {HTMLElement} container
   * @param {object} debugData
   * @param {{slowQueryThreshold:number, onSelect:function}} opts
   */
  function renderTimeline(container, debugData, opts) {
    const slowQueryThreshold = opts.slowQueryThreshold;
    const total = debugData.summary.time.total || 0;
    container.innerHTML = '';

    // v0의 timelineParts[].left/width(%)는 서버가 미리 계산해 보냈으나, v1은 timeline[].start/duration(초)만
    // 오므로 summary.time.total 을 분모로 여기서 계산한다(SCHEMA.md §8).
    const parts = (debugData.timeline || []).map((part) => ({
      name: part.name,
      duration: part.duration,
      left: total ? (part.start / total) * 100 : 0,
      width: total ? (part.duration / total) * 100 : 0,
    }));

    const wrap = document.createElement('div');
    wrap.className = 'd-timeline-wrap';

    const partsEl = document.createElement('div');
    partsEl.className = 'd-timeline-parts';
    parts.forEach((part) => {
      const el = document.createElement('div');
      el.className = 'd-part';
      el.style.cssText = 'left:' + part.left + '%;width:' + part.width + '%;';
      el.title = part.name + ' : ' + part.duration + 's (' + part.width.toFixed(2) + '%)';
      partsEl.appendChild(el);
    });
    wrap.appendChild(partsEl);

    const labelsEl = document.createElement('div');
    labelsEl.className = 'd-timeline-part-labels';
    parts.forEach((part) => {
      const label = document.createElement('span');
      label.className = 'd-part-label';
      label.style.cssText = 'left:' + part.left + '%;width:' + part.width + '%;';
      label.textContent = part.name;
      labelsEl.appendChild(label);
    });
    wrap.appendChild(labelsEl);

    const track = document.createElement('div');
    track.className = 'd-timeline';

    const timelineEntries = debugData.entries.filter((item) => item.duration);
    const laneInput = timelineEntries.map((item) => ({
      entry: item,
      tl_left: total ? (item.time / total) * 100 : 0,
      tl_width: total ? (item.duration / total) * 100 : 0,
    }));
    const placed = assignLanes(laneInput);

    placed.forEach(({ item: laneItem, lane }) => {
      const entry = laneItem.entry;
      const anchor = document.createElement('a');
      anchor.href = '#';
      anchor.dataset.didx = entry.index;
      const cls = speedClass(entry.duration, slowQueryThreshold);
      anchor.className = 'd-tl-item' + (cls ? ' ' + cls : '');
      anchor.style.gridRow = String(lane + 1);
      anchor.style.marginLeft = laneItem.tl_left + '%';
      anchor.style.width = laneItem.tl_width + '%';
      track.appendChild(anchor);
    });

    wrap.appendChild(track);

    const tip = document.createElement('div');
    tip.className = 'd-tl-tip';
    wrap.appendChild(tip);

    container.appendChild(wrap);

    const footer = document.createElement('div');
    footer.className = 'd-timeline-footer';

    if (parts.length) {
      const summary = document.createElement('div');
      summary.className = 'd-timeline-summary';
      parts.forEach((part) => {
        const item = document.createElement('span');
        item.className = 'd-tl-part-item';
        item.title = part.name + ' : ' + part.duration + 's (' + part.width.toFixed(2) + '%)';
        item.innerHTML =
          '<i class="d-tl-part-swatch"></i>' +
          escHtml(part.name) + ' ' + part.duration + 's (' + part.width.toFixed(2) + '%)';
        summary.appendChild(item);
      });
      footer.appendChild(summary);
    }

    const legend = document.createElement('div');
    legend.className = 'd-timeline-legend';
    legend.innerHTML =
      '<span class="d-tl-legend-item"><i class="d-tl-swatch"></i>normal</span>' +
      '<span class="d-tl-legend-item"><i class="d-tl-swatch d-q-mid"></i>mid</span>' +
      '<span class="d-tl-legend-item"><i class="d-tl-swatch d-q-slow"></i>slow</span>';
    footer.appendChild(legend);

    container.appendChild(footer);

    track.addEventListener('mouseover', (e) => {
      const anchor = e.target.closest('.d-tl-item');
      if (!anchor) return;
      const idx = parseInt(anchor.dataset.didx, 10);
      const item = timelineEntries.find((d) => d.index === idx);
      if (!item) return;
      tip.innerHTML = buildTooltipHtml(item);
      positionTooltip(tip, anchor, wrap);
    });

    track.addEventListener('mouseout', (e) => {
      const fromItem = e.target.closest('.d-tl-item');
      if (!fromItem) return;
      const toItem = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.d-tl-item');
      if (!toItem) tip.style.display = 'none';
    });

    track.addEventListener('click', (e) => {
      const anchor = e.target.closest('a[data-didx]');
      if (!anchor) return;
      e.preventDefault();
      const idx = parseInt(anchor.dataset.didx, 10);
      if (typeof opts.onSelect === 'function') opts.onSelect(idx);
    });
  }

  NS.Timeline = { renderTimeline, speedClass, assignLanes };
})(typeof self !== 'undefined' ? self : this);
