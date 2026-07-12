/*
 * Nova Debug — IDE 링크 생성
 *
 * trace.file / files[].path 는 서버 dirRoot 기준 상대경로다. ideConfig.localPath 를
 * 로컬 프로젝트 루트(=서버의 dirRoot 에 대응하는 로컬 경로)로 보고 이어붙인다.
 * meta.ide.serverPath 는 참고용으로만 전달되며 링크 생성에는 사용하지 않는다
 * (relPath 기반 이어붙이기만으로 충분 — DESIGN.md §9 재검토 대상).
 *
 * ideConfig: { protocol, localPath, project } — 옵션 페이지의 도메인별 매핑에서 옴.
 * 매핑이 없거나 localPath 미설정이면 링크를 만들지 않는다(null 반환).
 */
(function (root) {
  const NS = root.NovaDebugRenderer = root.NovaDebugRenderer || {};

  function build(relPath, line, ideConfig) {
    if (!relPath || !ideConfig || !ideConfig.localPath) return null;

    const base = ideConfig.localPath.replace(/\/$/, '');
    const file = base + (relPath.startsWith('/') ? relPath : '/' + relPath);
    const protocol = ideConfig.protocol || 'phpstorm';

    // vscode 만 URL 형식이 다르고, 그 외(phpstorm/idea/직접입력한 커스텀 프로토콜)는
    // JetBrains 계열 open?file=&line= 형식을 공통으로 사용한다.
    if (protocol === 'vscode') {
      return 'vscode://file/' + encodeURIComponent(file).replace(/%2F/g, '/') + ':' + (line || 0);
    }
    let link = protocol + '://open?file=' + encodeURIComponent(file) + '&line=' + (line || 0);
    if (ideConfig.project) link += '&project=' + encodeURIComponent(ideConfig.project);
    return link;
  }

  function resolveExt() {
    return (typeof browser !== 'undefined' && browser) || (typeof chrome !== 'undefined' && chrome) || null;
  }

  /**
   * phpstorm:// 등 커스텀 프로토콜 링크 클릭을 가로채 inspected 페이지에서 실행한다.
   * devtools 패널은 자체적으로 커스텀 프로토콜 navigation 이 통하지 않으므로
   * inspectedWindow.eval 로 페이지 쪽에서 로드를 트리거한다.
   * window.location.href 대입은 top-level navigation 으로 취급되어 Firefox 에서 커스텀 스킴도
   * devtools.network.onNavigated 를 발화시키고, preserveLog 가 꺼져 있으면 entries 가 비워진다.
   * 숨김 iframe 의 src 로 로드하면 top-level navigation 이 아니므로 onNavigated 가 발화하지 않는다
   * (Chrome/Firefox 공통 동작이며 기존 IDE 오픈 동작에는 영향 없음).
   * devtools API 가 없는 컨텍스트(예: test/preview.html)에서는 기존 anchor 기본 동작을 그대로 둔다.
   */
  function installClickInterceptor(rootEl) {
    if (!rootEl) return;
    rootEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href === '#' || /^https?:\/\//i.test(href)) return;

      const ext = resolveExt();
      if (!ext || !ext.devtools || !ext.devtools.inspectedWindow) return;

      e.preventDefault();
      const script = '(function(){' +
        'var f=document.createElement("iframe");' +
        'f.style.display="none";' +
        'f.src=' + JSON.stringify(href) + ';' +
        'document.body.appendChild(f);' +
        'setTimeout(function(){f.remove();},2000);' +
        '})();';
      ext.devtools.inspectedWindow.eval(script, (result, exceptionInfo) => {
        if (exceptionInfo) console.error('[NovaDebug] IDE 링크 실행 실패', exceptionInfo);
      });
    });
  }

  NS.IdeLink = { build, installClickInterceptor };
})(typeof self !== 'undefined' ? self : this);
