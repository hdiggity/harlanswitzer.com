(function () {
  function el(id) { return document.getElementById(id); }

  function formatTs(ts) {
    if (!ts) return '';
    return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function table(cols, rows, renderRow) {
    if (!rows || !rows.length) return '<p class="empty">no data</p>';
    var html = '<table><thead><tr>' +
      cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    rows.forEach(function (r) { html += '<tr>' + renderRow(r) + '</tr>'; });
    html += '</tbody></table>';
    return html;
  }

  function td(v) { return '<td>' + esc(v) + '</td>'; }

  async function init() {
    var meRes = await fetch('/auth/me');
    var me = await meRes.json();
    if (!me.loggedIn) {
      location.href = '/';
      return;
    }

    var logoutBtn = el('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        fetch('/auth/logout', { method: 'POST' }).then(function () {
          location.href = '/';
        });
      });
    }

    var res = await fetch('/admin/api');
    if (!res.ok) {
      document.body.innerHTML = '<p style="color:#6d28d9;padding:2rem">failed to load stats</p>';
      return;
    }
    var data = await res.json();

    // bot/human split
    var botSplitEl = el('botSplit');
    if (botSplitEl) {
      var human = 0, bot = 0;
      (data.botSplit || []).forEach(function (r) {
        if (r.verified_bot) bot += r.count; else human += r.count;
      });
      botSplitEl.innerHTML = '<span>human: <strong>' + human + '</strong></span>' +
        '  <span>bot: <strong>' + bot + '</strong></span>';
    }

    var recentReqEl = el('recentRequests');
    if (recentReqEl) {
      recentReqEl.innerHTML = table(
        ['time', 'method', 'path', 'status', 'country', 'bot_score'],
        data.recentRequests,
        function (r) {
          return td(formatTs(r.ts)) + td(r.method) + td(r.path) + td(r.status) + td(r.country) + td(r.bot_score);
        }
      );
    }

    var recentEvEl = el('recentEvents');
    if (recentEvEl) {
      recentEvEl.innerHTML = table(
        ['time', 'type', 'path', 'vid'],
        data.recentEvents,
        function (r) {
          return td(formatTs(r.ts)) + td(r.type) + td(r.path) + td(r.vid);
        }
      );
    }

    var topPathsEl = el('topPaths');
    if (topPathsEl) {
      topPathsEl.innerHTML = table(
        ['path', 'count'],
        data.topPaths,
        function (r) { return td(r.path) + td(r.count); }
      );
    }

    var topCountriesEl = el('topCountries');
    if (topCountriesEl) {
      topCountriesEl.innerHTML = table(
        ['country', 'count'],
        data.topCountries,
        function (r) { return td(r.country) + td(r.count); }
      );
    }

    var topReferersEl = el('topReferers');
    if (topReferersEl) {
      topReferersEl.innerHTML = table(
        ['referer', 'count'],
        data.topReferers,
        function (r) { return td(r.referer) + td(r.count); }
      );
    }
  }

  init();
})();
