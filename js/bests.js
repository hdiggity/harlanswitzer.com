(function () {
  // ── helpers ───────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── state ─────────────────────────────────────────────────────────────────
  var state = { byType: {}, activeSession: null, newBeer: null };

  // ── render beer list ──────────────────────────────────────────────────────
  function renderList() {
    var list = el('beerList');
    if (!list) return;
    var byType = state.byType;
    var types = Object.keys(byType).sort();
    if (!types.length) {
      list.innerHTML = '<p class="notice">no beers yet — add the first one</p>';
      return;
    }
    list.innerHTML = types.map(function (type) {
      var beers = byType[type] || [];
      var rows = beers.map(function (b) {
        var score = b.score != null
          ? '<span class="score-badge">' + esc(b.score.toFixed(1)) + '</span>'
          : '<span class="score-badge score-null">—</span>';
        var rank = '<span class="rank-num">' + (b.rank_index + 1) + '</span>';
        var sub = b.sub_type ? '<div class="cell-sub">' + esc(b.sub_type) + '</div>' : '';
        var where = [b.where_name, b.where_city_state, b.where_country].filter(Boolean).join(', ');
        return '<tr>' +
          '<td>' + rank + '</td>' +
          '<td>' + score + '</td>' +
          '<td><strong>' + esc(b.product) + '</strong>' + sub + '</td>' +
          '<td>' + esc(b.brewery) + '</td>' +
          '<td>' + esc(b.country_territory || '') + '</td>' +
          '<td>' + esc(where) + '</td>' +
          '<td>' + esc(b.when_text || '') + '</td>' +
          '</tr>';
      }).join('');
      return '<div class="type-group">' +
        '<p class="type-heading">' + esc(type) + ' (' + beers.length + ')</p>' +
        '<table><thead><tr>' +
        '<th>#</th><th>score</th><th>product</th><th>brewery</th><th>country</th><th>where</th><th>when</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '</div>';
    }).join('');
  }

  // ── show comparison modal ─────────────────────────────────────────────────
  function showComparison(newBeer, candidate) {
    state.newBeer = newBeer;
    el('cmpNewBrewery').textContent    = newBeer.brewery || '';
    el('cmpNewProduct').textContent    = newBeer.product || '';
    el('cmpNewType').textContent       = newBeer.type || '';
    el('cmpCandidateBrewery').textContent = candidate.brewery || '';
    el('cmpCandidateProduct').textContent = candidate.product || '';
    el('cmpCandidateType').textContent    = candidate.type || '';
    el('cmpModal').removeAttribute('hidden');
  }

  function hideCmpModal() {
    el('cmpModal').setAttribute('hidden', '');
  }

  // ── submit comparison choice ──────────────────────────────────────────────
  async function submitChoice(winner) {
    var sessionId = state.activeSession && state.activeSession.id;
    if (!sessionId) return;

    var res = await fetch('/bests/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'submit_choice', session_id: sessionId, winner: winner }),
    });
    var d = await res.json();
    if (!res.ok) { alert(d.error || 'error'); return; }

    if (d.completed) {
      hideCmpModal();
      state.activeSession = null;
      // refresh data
      await loadData();
    } else {
      state.activeSession.candidate_beer_id = d.next_comparison.candidate.id;
      showComparison(state.newBeer, d.next_comparison.candidate);
    }
  }

  // ── cancel session ────────────────────────────────────────────────────────
  async function cancelSession() {
    var sessionId = state.activeSession && state.activeSession.id;
    if (sessionId) {
      await fetch('/bests/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_session', session_id: sessionId }),
      });
    }
    state.activeSession = null;
    hideCmpModal();
  }

  // ── load data ─────────────────────────────────────────────────────────────
  async function loadData() {
    var res = await fetch('/bests/api');
    if (res.status === 401) { location.href = '/'; return; }
    if (res.status === 403) {
      el('beerList').innerHTML = '<p class="notice">access restricted</p>';
      return;
    }
    if (!res.ok) {
      el('beerList').innerHTML = '<p class="notice">failed to load (' + res.status + ')</p>';
      return;
    }
    var d = await res.json();
    state.byType = d.beers_by_type || {};
    state.activeSession = d.active_session || null;
    renderList();

    // resume active session if exists
    if (state.activeSession && state.activeSession.candidate_beer) {
      state.newBeer = state.activeSession.new_beer;
      showComparison(state.activeSession.new_beer, state.activeSession.candidate_beer);
    }
  }

  // ── add beer modal ────────────────────────────────────────────────────────
  function openAddModal() {
    el('addForm').reset();
    el('addError').textContent = '';
    el('addModal').removeAttribute('hidden');
    el('f-brewery').focus();
  }

  function closeAddModal() {
    el('addModal').setAttribute('hidden', '');
  }

  // ── init ──────────────────────────────────────────────────────────────────
  async function init() {
    var meRes = await fetch('/auth/me');
    var me = await meRes.json();
    if (!me.loggedIn) { location.href = '/'; return; }

    el('logoutBtn').addEventListener('click', function () {
      fetch('/auth/logout', { method: 'POST' }).then(function () { location.href = '/'; });
    });

    el('addBeerBtn').addEventListener('click', openAddModal);
    el('addModalClose').addEventListener('click', closeAddModal);
    el('addCancel').addEventListener('click', closeAddModal);

    el('addForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      el('addError').textContent = '';
      el('addSubmit').disabled = true;

      var beer = {
        brewery:          el('f-brewery').value.trim(),
        product:          el('f-product').value.trim(),
        type:             el('f-type').value.trim(),
        sub_type:         el('f-sub-type').value.trim() || null,
        country_territory: el('f-country').value.trim() || null,
        where_name:       el('f-where-name').value.trim() || null,
        where_city_state: el('f-where-city').value.trim() || null,
        where_country:    el('f-where-country').value.trim() || null,
        when_text:        el('f-when').value.trim() || null,
        event_notes:      el('f-notes').value.trim() || null,
      };

      var res = await fetch('/bests/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_beer', beer: beer }),
      });
      var d = await res.json();
      el('addSubmit').disabled = false;

      if (!res.ok) {
        el('addError').textContent = d.error || 'error';
        return;
      }

      closeAddModal();

      if (d.completed) {
        await loadData();
      } else {
        state.activeSession = { id: d.session_id, new_beer_id: d.created_beer.id };
        state.newBeer = d.created_beer;
        // refresh list in background, then show comparison
        await loadData();
        showComparison(d.created_beer, d.next_comparison.candidate);
      }
    });

    // comparison card clicks
    el('cmpCardNew').addEventListener('click', function () { submitChoice('new'); });
    el('cmpCardCandidate').addEventListener('click', function () { submitChoice('candidate'); });
    el('cmpCardNew').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') submitChoice('new'); });
    el('cmpCardCandidate').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') submitChoice('candidate'); });
    el('cmpCancel').addEventListener('click', cancelSession);

    await loadData();
  }

  init();
})();
