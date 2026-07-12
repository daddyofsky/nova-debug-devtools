/*
 * Nova Debug — SQL Formatter (Nova/debug/assets/debug.js SQLFormatter 이식)
 * panel/panel.js, panel/renderer/*.js 에서 <script> 로드로 사용. window.NovaDebugRenderer 네임스페이스에 부착.
 */
(function (root) {
  const NS = root.NovaDebugRenderer = root.NovaDebugRenderer || {};

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const KEYWORDS_RE = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE|FROM|WHERE|HAVING|ORDER\s+BY|GROUP\s+BY|LIMIT|OFFSET|(?:(?:INNER|LEFT|RIGHT|OUTER)\s+)?JOIN|UNION(?:\s+ALL)?|VALUES|SET|ON|AS|AND|OR|IN|NOT|EXISTS|BETWEEN|LIKE|IS\s+NOT\s+NULL|IS\s+NULL|DISTINCT|CASE|WHEN|THEN|ELSE|END)\b/gi;
  const CLAUSE_KW_RE = /\b(SELECT|FROM|WHERE|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|INSERT\s+INTO|UPDATE|DELETE|VALUES|SET|(?:(?:INNER|LEFT|RIGHT|OUTER)\s+)?JOIN|UNION(?:\s+ALL)?)\b\s?/gi;
  const TABLE_NAME_RE = /\b(?:FROM|(?:(?:INNER|LEFT|RIGHT|OUTER)\s+)?JOIN|INTO|UPDATE)\s+(`?\w+`?)/gi;
  const INLINE_KW = ['FROM', 'ORDER BY', 'GROUP BY', 'LIMIT'];

  function uppercase(sql) {
    return sql.replace(KEYWORDS_RE, function (m) { return m.toUpperCase(); });
  }

  function highlightTableNames(sql, tpl) {
    return sql.replace(TABLE_NAME_RE, function (match, tblName) {
      const idx = match.lastIndexOf(tblName);
      return match.substring(0, idx) + tpl.replace('$1', tblName);
    });
  }

  function extractSubqueries(sql, subs) {
    let result = '';
    const len = sql.length;
    let i = 0;
    while (i < len) {
      if (sql[i] === '(' && /\(\s*SELECT\b/i.test(sql.substring(i, i + 20))) {
        let depth = 1;
        let j = i + 1;
        while (j < len && depth > 0) {
          if (sql[j] === '(') depth++;
          else if (sql[j] === ')') depth--;
          j++;
        }
        const idx = subs.length;
        subs.push(sql.substring(i + 1, j - 1));
        result += '\x00SUB' + idx + '\x00';
        i = j;
      } else {
        result += sql[i];
        i++;
      }
    }
    return result;
  }

  /**
   * plain text 포맷 — 개행 + indent + 서브쿼리 재귀
   */
  function format(sql, indent, depth) {
    indent = indent || '\t';
    depth = depth || 0;
    sql = uppercase(sql);
    const prefix = indent.repeat(depth);
    const content = prefix + indent;

    const subs = [];
    sql = extractSubqueries(sql, subs);

    const parens = [];
    let prev;
    do {
      prev = sql;
      sql = sql.replace(/\([^()\x00]*\)/g, function (m) {
        const idx = parens.length;
        parens.push(m);
        return '\x02P' + idx + '\x02';
      });
    } while (sql !== prev);

    const parts = sql.split(CLAUSE_KW_RE);
    sql = '';
    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];
      const kwUpper = part.replace(/\s+/g, ' ').trim().toUpperCase();
      if (i % 2 === 1) {
        const body = parts[i + 1] || '';
        let isInline = INLINE_KW.indexOf(kwUpper) >= 0;
        if (kwUpper === 'SELECT' && body.trim().length < 40) isInline = true;
        if (/^(WHERE|HAVING|.*JOIN)$/.test(kwUpper) && !/\bAND\b/i.test(body)) isInline = true;
        if (isInline) {
          sql += '\n' + prefix + part + ' ';
        } else {
          sql += '\n' + prefix + part + '\n' + content;
        }
      } else if (i === 0) {
        if (part.trim() !== '') sql += part;
      } else {
        part = part.replace(/\bAND\s?/gi, '\n' + content + 'AND ');
        sql += part;
      }
    }

    for (let idx = parens.length - 1; idx >= 0; idx--) {
      sql = sql.replace('\x02P' + idx + '\x02', parens[idx]);
    }

    const subIndent = indent.repeat(depth + 1);
    const subBody = indent.repeat(depth + 2);
    for (let si = 0; si < subs.length; si++) {
      let innerFmt = format(subs[si], indent, depth + 2);
      innerFmt = subBody + innerFmt.replace(/^\s+/, '');
      let formatted = '\n' + subIndent + '(\n' + innerFmt + '\n' + subIndent + ')';

      const placeholder = '\x00SUB' + si + '\x00';
      const pos = sql.indexOf(placeholder);
      if (pos !== -1) {
        const after = sql.substring(pos + placeholder.length);
        const aliasMatch = after.match(/^(\s*(?:AS\s+)?`?\w+`?\s*,?\s*)([\s\S]*)$/i);
        if (aliasMatch) {
          formatted += aliasMatch[1] + '\n' + content;
          sql = sql.substring(0, pos) + formatted + aliasMatch[2];
        } else {
          const commaMatch = after.match(/^(\s*,?\s*)([\s\S]*)$/);
          if (commaMatch) {
            formatted += commaMatch[1] + '\n' + content;
            sql = sql.substring(0, pos) + formatted + commaMatch[2];
          } else {
            sql = sql.substring(0, pos) + formatted + after;
          }
        }
      }
    }

    sql = sql.replace(/\n\s*\n/g, '\n');
    return depth === 0 ? sql.replace(/^\s+/, '') : sql;
  }

  /**
   * 구조화된 포맷 — format() 기반 + 키워드 색상 태그. <code class="d-sql"> 래핑
   */
  function pretty(sql) {
    if (!sql) return '';
    const isDml = /^(INSERT|UPDATE|DELETE)\b/i.test(sql.trim());

    sql = format(sql);
    sql = escHtml(sql);
    sql = highlightTableNames(sql, '<b class="d-tbl">$1</b>');
    sql = sql.replace(/\b(SELECT|FROM|WHERE|ORDER BY|GROUP BY|HAVING|LIMIT|INSERT INTO|UPDATE|DELETE|VALUES|SET)\b/g, '<b class="d-kw">$1</b>');
    sql = sql.replace(/\b(ON|AS|AND|OR|IN|NOT|EXISTS|BETWEEN|LIKE|IS NOT NULL|IS NULL|DISTINCT|OFFSET|CASE|WHEN|THEN|ELSE|END)\b/g, '<b class="d-kw-sub">$1</b>');
    sql = sql.replace(/\b((?:(?:INNER|LEFT|RIGHT|OUTER) )?JOIN)\b/g, '<b class="d-kw-join">$1</b>');
    sql = sql.replace(/\b(UNION(?: ALL)?)\b/g, '<b class="d-kw-union">$1</b>');

    const cls = isDml ? 'd-sql d-dml' : 'd-sql';
    return '<code class="' + cls + '">' + sql + '</code>';
  }

  /**
   * 인라인 하이라이트 — 키워드 색상 + 테이블명 강조
   */
  function simple(sql) {
    if (!sql) return '';
    sql = uppercase(sql);
    sql = highlightTableNames(sql, '<span style="color:#ff3700; font-weight:bold">$1</span>');

    sql = sql.replace(/\b(SELECT|FROM|WHERE|HAVING|ORDER\s+BY|GROUP\s+BY|LIMIT|INSERT\s+INTO|UPDATE|DELETE|VALUES|SET)(?=\s)/gi, '<span style="color:#0061c0; font-weight:bold">$1</span>');
    sql = sql.replace(/\b(ON|AS|AND|OR|IN|NOT|EXISTS|BETWEEN|LIKE|IS\s+NOT\s+NULL|IS\s+NULL|DISTINCT|OFFSET|CASE|WHEN|THEN|ELSE|END)\b/gi, '<span style="color:#0061c0; font-weight:normal">$1</span>');
    sql = sql.replace(/\b(((?:INNER|LEFT|RIGHT|OUTER)\s+)?JOIN)(?=\s)/gi, '<span style="color:#3a923a; font-weight:bold">$1</span>');
    sql = sql.replace(/\b(UNION(?:\s+ALL)?)(?=\s)/gi, '<span style="color:#9c27b0; font-weight:bold">$1</span>');

    if (/^(INSERT|UPDATE|DELETE)\b/i.test(sql.replace(/<[^>]*>/g, ''))) {
      return '<span class="d-dml">' + sql + '</span>';
    }
    return sql;
  }

  /**
   * IN (...) 절에 항목이 많을 경우 축약 표시
   */
  function truncateIn(sql, maxItems) {
    if (!sql) return sql;
    maxItems = maxItems || 10;
    return sql.replace(/\bIN\s*\(([^()]+)\)/gi, function (match, inner) {
      const items = [];
      let current = '';
      let inQuote = false;
      let quoteChar = '';
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (inQuote) {
          current += ch;
          if (ch === quoteChar && (i === 0 || inner[i - 1] !== '\\')) inQuote = false;
        } else if (ch === "'" || ch === '"') {
          current += ch;
          inQuote = true;
          quoteChar = ch;
        } else if (ch === ',') {
          items.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      if (current.trim()) items.push(current.trim());
      if (items.length <= maxItems) return match;
      const shown = items.slice(0, maxItems).join(', ');
      return 'IN (' + shown + ', …+' + (items.length - maxItems) + ')';
    });
  }

  NS.escHtml = escHtml;
  NS.SqlFormatter = { format, pretty, simple, truncateIn };
})(typeof self !== 'undefined' ? self : this);
