(function () {
  var hours = Number(localStorage.getItem('admin_hours')) || 24;

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(n) { return (n || 0).toLocaleString(); }

  function fmtTs(ts) {
    if (!ts) return '';
    return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16);
  }

  function fmtDur(s) {
    if (!s || s <= 0) return '—';
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    return (s / 3600).toFixed(1) + 'h';
  }

  function badge(cls) {
    var labels = { human: 'human', automated: 'auto', unknown: '?' };
    return '<span class="badge badge-' + cls + '">' + (labels[cls] || cls) + '</span>';
  }

  function statusCls(s) {
    if (s >= 500) return 's5';
    if (s >= 400) return 's4';
    if (s >= 300) return 's3';
    if (s >= 200) return 's2';
    return '';
  }

  function td(v, cls) {
    return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</td>';
  }

  function mkTable(cols, rows, rowFn) {
    if (!rows || !rows.length) return '<p class="empty">no data</p>';
    var html = '<table><thead><tr>' +
      cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    rows.forEach(function (r) { html += '<tr>' + rowFn(r) + '</tr>'; });
    return html + '</tbody></table>';
  }

  function bars(rows, keyProp, cntProp) {
    if (!rows || !rows.length) return '<p class="empty">no data</p>';
    var max = rows[0][cntProp] || 1;
    return '<div class="bar-list">' + rows.map(function (r) {
      var pct = Math.round(r[cntProp] / max * 100);
      return '<div class="bar-row">' +
        '<span class="bar-label" title="' + esc(r[keyProp]) + '">' + esc(r[keyProp]) + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="bar-count">' + esc(r[cntProp]) + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  // ── init CSS + shell ──────────────────────────────────────────────────────

  function setup() {
    // inject dynamic styles
    var s = document.createElement('style');
    s.textContent = [
      '.summary { display: block !important; padding: 20px 28px !important; }',
      '.cls-table { width: 100%; border-collapse: collapse; }',
      '.cls-table th { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding: 4px 20px 10px; text-align: right; font-weight: 500; white-space: nowrap; }',
      '.cls-table th:first-child { text-align: left; padding-left: 0; }',
      '.cls-table td { padding: 10px 20px; text-align: right; font-size: 24px; font-weight: 800; letter-spacing: -.02em; line-height: 1; }',
      '.cls-table td:first-child { text-align: left; font-size: 13px; font-weight: 400; letter-spacing: 0; vertical-align: middle; padding-left: 0; }',
      '.cls-table tr + tr td { border-top: 1px solid var(--border); }',
      '.badge { display: inline-block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; padding: 3px 8px; border-radius: 99px; font-weight: 700; }',
      '.badge-human     { background: rgba(22,163,74,.12); color: #16a34a; }',
      '.badge-automated { background: rgba(220,38,38,.10); color: #dc2626; }',
      '.badge-unknown   { background: rgba(109,40,217,.10); color: var(--muted); }',
      '.score-pos { color: #16a34a; font-weight: 700; }',
      '.score-neg { color: #dc2626; font-weight: 700; }',
      '.win-pills { display: flex; gap: 4px; margin-right: 4px; }',
      '.win-pill { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; padding: 5px 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border); color: var(--muted); background: none; font-family: var(--font); transition: color 150ms, background 150ms, border-color 150ms; }',
      '.win-pill:hover { color: var(--fg); border-color: var(--fg); }',
      '.win-pill.active { color: #fff; background: var(--fg); border-color: var(--fg); }',
      '.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }',
      '@media (max-width: 720px) { .two-col { grid-template-columns: 1fr; } }',
      '.ptitle { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; font-weight: 600; }',
      '.psec { margin-bottom: 28px; }',
      '.notice { font-size: 11px; color: #d97706; background: rgba(217,119,6,.08); border: 1px solid rgba(217,119,6,.2); border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; }',
      '.loading { color: var(--muted); font-size: 12px; padding: 32px 0; text-align: center; letter-spacing: .04em; }',
    ].join('\n');
    document.head.appendChild(s);

    // time window pills
    var hdRight = document.querySelector('.hd-right');
    if (hdRight) {
      var pills = document.createElement('div');
      pills.className = 'win-pills';
      [
        { h: 1, label: '1h' }, { h: 6, label: '6h' }, { h: 24, label: '24h' },
        { h: 48, label: '2d' }, { h: 168, label: '7d' },
      ].forEach(function (w) {
        var b = document.createElement('button');
        b.className = 'win-pill' + (w.h === hours ? ' active' : '');
        b.textContent = w.label;
        b.addEventListener('click', function () {
          hours = w.h;
          localStorage.setItem('admin_hours', hours);
          document.querySelectorAll('.win-pill').forEach(function (p) { p.classList.remove('active'); });
          b.classList.add('active');
          reload();
        });
        pills.appendChild(b);
      });
      hdRight.insertBefore(pills, hdRight.firstChild);
    }

    // classification summary table
    var summary = document.querySelector('.summary');
    if (summary) {
      summary.innerHTML =
        '<table class="cls-table"><thead><tr>' +
        '<th></th><th>visitors</th><th>sessions</th><th>pageviews</th><th>requests</th>' +
        '</tr></thead><tbody>' +
        ['human', 'automated', 'unknown'].map(function (cls) {
          return '<tr>' +
            '<td>' + badge(cls) + '</td>' +
            '<td id="stat-' + cls + '-v">—</td>' +
            '<td id="stat-' + cls + '-s">—</td>' +
            '<td id="stat-' + cls + '-p">—</td>' +
            '<td id="stat-' + cls + '-r">—</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    // tab click handlers
    var nav = document.querySelector('.tabs');
    if (nav) {
      nav.querySelectorAll('.tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
          nav.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
          document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
          tab.classList.add('active');
          var panel = el('panel-' + tab.dataset.tab);
          if (panel) panel.classList.add('active');
        });
      });
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  function setCard(id, value) {
    var e = el(id);
    if (e) e.textContent = num(value);
  }

  function renderOverview(d) {
    var c = el('cnt-overview');
    if (!c) return;
    var notice = d.truncated
      ? '<p class="notice">request cap reached (10,000) — window may be underrepresented; try a shorter range</p>'
      : '';
    c.innerHTML = notice +
      '<div class="two-col">' +
      '<div class="psec"><p class="ptitle">top countries — human</p>' +
      bars(d.top_countries_human, 'country', 'count') + '</div>' +
      '<div class="psec"><p class="ptitle">top countries — automated</p>' +
      bars(d.top_countries_automated, 'country', 'count') + '</div>' +
      '</div>' +
      '<div class="psec"><p class="ptitle">top referrers — human</p>' +
      bars(d.top_referrers_human, 'referer', 'count') + '</div>';
  }

  function renderDiagnostics(d) {
    var c = el('cnt-diagnostics');
    if (!c) return;
    var agents = d.top_automated_agents && d.top_automated_agents.length
      ? '<div class="bar-list">' + d.top_automated_agents.map(function (r) {
          return '<div class="bar-row">' +
            '<span class="bar-label" title="' + esc(r.agent) + '">' + esc(r.agent) + '</span>' +
            '<span class="bar-count">' + esc(r.count) + '</span></div>';
        }).join('') + '</div>'
      : '<p class="empty">no data</p>';
    c.innerHTML =
      '<div class="two-col">' +
      '<div class="psec"><p class="ptitle">suspicious paths — automated</p>' +
      bars(d.top_suspicious_paths, 'path', 'count') + '</div>' +
      '<div class="psec"><p class="ptitle">automated agents</p>' + agents + '</div>' +
      '</div>';
  }

  function renderSessions(d) {
    var c = el('cnt-sessions');
    if (!c) return;
    c.innerHTML = '<div class="tbl-wrap">' + mkTable(
      ['time', 'class', 'score', 'country', 'reqs', 'pvs', 'dur', 'first path', 'agent'],
      d.recent_sessions,
      function (s) {
        var sc    = s.score > 0 ? '+' + s.score : String(s.score);
        var scCls = s.score >= 2 ? 'score-pos' : (s.score <= -2 ? 'score-neg' : '');
        return td(fmtTs(s.ts)) +
          '<td>' + badge(s.cls) + '</td>' +
          '<td class="' + scCls + '">' + esc(sc) + '</td>' +
          td(s.country || '—') +
          td(s.requests) + td(s.pageviews) + td(fmtDur(s.duration)) +
          td(s.first_path) +
          '<td title="' + esc(s.ua) + '">' + esc(s.ua.slice(0, 50)) + (s.ua.length > 50 ? '…' : '') + '</td>';
      }
    ) + '</div>';
  }

  function renderRequests(d) {
    var c = el('cnt-requests');
    if (!c) return;
    c.innerHTML = '<div class="tbl-wrap">' + mkTable(
      ['time', 'method', 'path', 'status', 'country', 'cf score', 'bot', 'referer'],
      d.recent_requests,
      function (r) {
        var sc = r.bot_score !== null && r.bot_score !== undefined ? r.bot_score : '—';
        return td(fmtTs(r.ts)) +
          td(r.method) +
          td(r.path) +
          td(r.status, statusCls(r.status)) +
          td(r.country || '—') +
          td(sc) +
          td(r.verified_bot ? 'yes' : '') +
          '<td title="' + esc(r.referer) + '">' + esc((r.referer || '').slice(0, 40)) + '</td>';
      }
    ) + '</div>';
  }

  // ── data load ─────────────────────────────────────────────────────────────

  async function reload() {
    ['overview', 'diagnostics', 'sessions', 'requests'].forEach(function (t) {
      var c = el('cnt-' + t);
      if (c) c.innerHTML = '<p class="loading">loading…</p>';
    });

    var res = await fetch('/admin/api?hours=' + hours);
    if (!res.ok) {
      ['overview', 'diagnostics', 'sessions', 'requests'].forEach(function (t) {
        var c = el('cnt-' + t);
        if (c) c.textContent = 'failed to load (' + res.status + ')';
      });
      return;
    }
    var d = await res.json();

    ['human', 'automated', 'unknown'].forEach(function (cls) {
      var s = (d.summary && d.summary[cls]) || {};
      setCard('stat-' + cls + '-v', s.visitors);
      setCard('stat-' + cls + '-s', s.sessions);
      setCard('stat-' + cls + '-p', s.pageviews);
      setCard('stat-' + cls + '-r', s.requests);
    });

    renderOverview(d);
    renderDiagnostics(d);
    renderSessions(d);
    renderRequests(d);
  }

  // ── init ──────────────────────────────────────────────────────────────────

  async function init() {
    var meRes = await fetch('/auth/me');
    var me    = await meRes.json();
    if (!me.loggedIn) { location.href = '/'; return; }

    el('logoutBtn').addEventListener('click', function () {
      fetch('/auth/logout', { method: 'POST' }).then(function () { location.href = '/'; });
    });

    setup();
    reload();
  }

  init();
})();
