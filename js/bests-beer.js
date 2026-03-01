(function () {
  // ── state ─────────────────────────────────────────────────────────────────
  var state = {
    allBeers: [],
    activeSession: null,
    newBeer: null,
    filterType: 'all',
    filters: { country: '', brewery: '', where: '', sub_type: '' },
    sortCol: 'score',
    sortDir: 'desc',
  };

  // ── helpers ───────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stripEmoji(s) {
    if (s == null) return '';
    return String(s).replace(/[\u{1F1E0}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, '').trim();
  }

  function formatWhen(b) {
    if (b.when_ts) {
      var d = new Date(b.when_ts * 1000);
      return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
    }
    return b.when_text || '';
  }

  function api(method, body) {
    var opts = { method: method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch('/bests/api', opts);
  }

  // ── autocomplete datalists ────────────────────────────────────────────────
  function populateDataLists(beers) {
    var sets = { brewery: new Set(), type: new Set(), sub_type: new Set(), country: new Set(),
                 where_name: new Set(), where_city: new Set(), where_country: new Set(), when: new Set() };
    beers.forEach(function (b) {
      if (b.brewery)           sets.brewery.add(b.brewery);
      if (b.type)              sets.type.add(b.type);
      if (b.sub_type)          sets.sub_type.add(b.sub_type);
      if (b.country_territory) sets.country.add(stripEmoji(b.country_territory));
      if (b.where_name)        sets.where_name.add(b.where_name);
      if (b.where_city_state)  sets.where_city.add(b.where_city_state);
      if (b.where_country)     sets.where_country.add(b.where_country);
      if (b.when_text)         sets.when.add(b.when_text);
    });
    var map = { 'dl-brewery': sets.brewery, 'dl-type': sets.type, 'dl-sub-type': sets.sub_type,
                'dl-country': sets.country, 'dl-where-name': sets.where_name,
                'dl-where-city': sets.where_city, 'dl-where-country': sets.where_country, 'dl-when': sets.when };
    Object.keys(map).forEach(function (id) {
      var dl = el(id);
      if (!dl) return;
      dl.innerHTML = Array.from(map[id]).sort().map(function (v) {
        return '<option value="' + esc(v) + '">';
      }).join('');
    });
  }

  // ── type filter ───────────────────────────────────────────────────────────
  function renderTypeFilter() {
    var types = Array.from(new Set(state.allBeers.map(function (b) { return b.type; }))).sort();
    var container = el('typeFilter');
    if (!container) return;
    var pills = [{ label: 'all', value: 'all' }].concat(types.map(function (t) {
      return { label: t, value: t };
    }));
    container.innerHTML = pills.map(function (p) {
      return '<button class="type-pill' + (state.filterType === p.value ? ' active' : '') +
        '" data-type="' + esc(p.value) + '">' + esc(p.label) + '</button>';
    }).join('');
    container.querySelectorAll('.type-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.filterType = btn.dataset.type;
        renderTypeFilter();
        renderFilterBar();
        renderList();
      });
    });
  }

  // ── secondary filter bar ──────────────────────────────────────────────────
  function renderFilterBar() {
    var bar = el('filterBar');
    if (!bar) return;

    var base = state.filterType === 'all'
      ? state.allBeers
      : state.allBeers.filter(function (b) { return b.type === state.filterType; });

    var countries  = Array.from(new Set(base.map(function (b) { return stripEmoji(b.country_territory || ''); }).filter(Boolean))).sort();
    var breweries  = Array.from(new Set(base.map(function (b) { return b.brewery || ''; }).filter(Boolean))).sort();
    var wheres     = Array.from(new Set(base.map(function (b) { return b.where_city_state || ''; }).filter(Boolean))).sort();
    var subTypes   = Array.from(new Set(base.map(function (b) { return b.sub_type || ''; }).filter(Boolean))).sort();

    function combo(id, dlId, placeholder, opts, cur) {
      var dl = '<datalist id="' + dlId + '">' +
        opts.map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') +
        '</datalist>';
      return '<input class="filter-input" id="' + id + '" type="text" placeholder="' + placeholder +
        '" list="' + dlId + '" value="' + esc(cur) + '" autocomplete="off" />' + dl;
    }

    bar.innerHTML =
      combo('filterCountry', 'fb-country-list',   'country',  countries, state.filters.country) +
      combo('filterBrewery', 'fb-brewery-list',   'brewery',  breweries, state.filters.brewery) +
      combo('filterSubType', 'fb-sub-type-list',  'sub-type', subTypes,  state.filters.sub_type) +
      combo('filterWhere',   'fb-where-list',     'city',     wheres,    state.filters.where);

    bar.querySelectorAll('.filter-input').forEach(function (s) {
      s.addEventListener('input', function () {
        state.filters.country  = (el('filterCountry') && el('filterCountry').value) || '';
        state.filters.brewery  = (el('filterBrewery') && el('filterBrewery').value) || '';
        state.filters.sub_type = (el('filterSubType') && el('filterSubType').value) || '';
        state.filters.where    = (el('filterWhere')   && el('filterWhere').value)   || '';
        renderList();
      });
    });
  }

  // ── sorting ───────────────────────────────────────────────────────────────
  function sortValue(b, col) {
    switch (col) {
      case 'score':   return b.score != null ? b.score : -1;
      case 'product': return (b.product || '').toLowerCase();
      case 'brewery': return (b.brewery || '').toLowerCase();
      case 'country': return (b.country_territory || '').toLowerCase();
      case 'where':   return ([b.where_name, b.where_city_state, b.where_country].filter(Boolean).join(', ')).toLowerCase();
      case 'when':    return b.when_ts != null ? b.when_ts : -Infinity;
      default:        return '';
    }
  }

  function filteredAndSorted() {
    var beers = state.allBeers.slice();
    if (state.filterType !== 'all') beers = beers.filter(function (b) { return b.type === state.filterType; });
    if (state.filters.country) {
      var fc = state.filters.country.toLowerCase();
      beers = beers.filter(function (b) { return b.country_territory && stripEmoji(b.country_territory).toLowerCase().includes(fc); });
    }
    if (state.filters.brewery) {
      var fb = state.filters.brewery.toLowerCase();
      beers = beers.filter(function (b) { return b.brewery && b.brewery.toLowerCase().includes(fb); });
    }
    if (state.filters.sub_type) {
      var fs = state.filters.sub_type.toLowerCase();
      beers = beers.filter(function (b) { return b.sub_type && b.sub_type.toLowerCase().includes(fs); });
    }
    if (state.filters.where) {
      var fw = state.filters.where.toLowerCase();
      beers = beers.filter(function (b) { return b.where_city_state && b.where_city_state.toLowerCase().includes(fw); });
    }
    var col = state.sortCol, dir = state.sortDir;
    beers.sort(function (a, b) {
      var av = sortValue(a, col), bv = sortValue(b, col);
      var cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
    return beers;
  }

  // ── table render ──────────────────────────────────────────────────────────
  var COLS = [
    { id: 'score',   label: 'score'   },
    { id: 'product', label: 'product' },
    { id: 'brewery', label: 'brewery' },
    { id: 'country', label: 'country' },
    { id: 'where',   label: 'where'   },
    { id: 'when',    label: 'when'    },
    { id: 'notes',   label: 'notes', nosort: true },
  ];

  function arrow(col) {
    if (state.sortCol !== col) return '';
    return '<span class="sort-arrow">' + (state.sortDir === 'asc' ? '▲' : '▼') + '</span>';
  }

  function renderList() {
    var listEl = el('beerList');
    if (!listEl) return;
    var beers = filteredAndSorted();
    if (!beers.length) {
      listEl.innerHTML = '<p class="notice">no beers match the current filters</p>';
      return;
    }

    var thead = '<thead><tr>' +
      COLS.map(function (c) {
        if (c.nosort) return '<th>' + c.label + '</th>';
        var active = state.sortCol === c.id ? ' sort-active' : '';
        return '<th class="sortable' + active + '" data-col="' + c.id + '">' + c.label + arrow(c.id) + '</th>';
      }).join('') +
      '<th></th></tr></thead>';

    var tbody = '<tbody>' + beers.map(function (b) {
      var score = b.score != null
        ? '<span class="score-val">' + b.score.toFixed(1) + '</span>'
        : '<span class="score-null">—</span>';
      var product = esc(b.product) + (b.sub_type ? '<div class="cell-sub">' + esc(b.sub_type) + '</div>' : '');
      var where = [b.where_name, b.where_city_state, b.where_country].filter(Boolean).join(', ');
      var notes = b.event_notes ? '<span class="cell-notes">' + esc(b.event_notes) + '</span>' : '';
      return '<tr>' +
        '<td>' + score + '</td>' +
        '<td>' + product + '</td>' +
        '<td>' + esc(b.brewery) + '</td>' +
        '<td>' + esc(stripEmoji(b.country_territory || '')) + '</td>' +
        '<td>' + esc(where) + '</td>' +
        '<td>' + esc(formatWhen(b)) + '</td>' +
        '<td class="cell-notes-col">' + notes + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn-edit"   data-id="' + b.id + '">edit</button>' +
          '<button class="btn-remove" data-id="' + b.id + '">remove</button>' +
        '</div></td>' +
        '</tr>';
    }).join('') + '</tbody>';

    listEl.innerHTML = '<table>' + thead + tbody + '</table>';

    listEl.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.dataset.col;
        if (state.sortCol === col) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortCol = col;
          state.sortDir = col === 'score' || col === 'when' ? 'desc' : 'asc';
        }
        renderList();
      });
    });

    listEl.querySelectorAll('.btn-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var beer = state.allBeers.find(function (b) { return b.id === parseInt(btn.dataset.id, 10); });
        if (beer) openEditModal(beer);
      });
    });

    listEl.querySelectorAll('.btn-remove').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteBeer(parseInt(btn.dataset.id, 10)); });
    });
  }

  // ── edit modal ────────────────────────────────────────────────────────────
  var editDebounceTimer = null;
  var editingBeerId = null;

  function openEditModal(beer) {
    editingBeerId = beer.id;
    el('e-brewery').value       = beer.brewery || '';
    el('e-product').value       = beer.product || '';
    el('e-type').value          = beer.type || '';
    el('e-sub-type').value      = beer.sub_type || '';
    el('e-country').value       = stripEmoji(beer.country_territory || '');
    el('e-where-name').value    = beer.where_name || '';
    el('e-where-city').value    = beer.where_city_state || '';
    el('e-where-country').value = beer.where_country || '';
    el('e-when').value          = beer.when_text || '';
    el('e-notes').value         = beer.event_notes || '';
    el('editSaveStatus').textContent = '';
    el('editModal').removeAttribute('hidden');
    el('e-brewery').focus();
  }

  function closeEditModal() {
    el('editModal').setAttribute('hidden', '');
    clearTimeout(editDebounceTimer);
    editingBeerId = null;
  }

  function scheduleAutoSave() {
    clearTimeout(editDebounceTimer);
    el('editSaveStatus').textContent = 'saving…';
    editDebounceTimer = setTimeout(autoSave, 700);
  }

  async function autoSave() {
    if (!editingBeerId) return;
    var updates = {
      brewery:          el('e-brewery').value.trim(),
      product:          el('e-product').value.trim(),
      sub_type:         el('e-sub-type').value.trim() || null,
      country_territory:el('e-country').value.trim() || null,
      where_name:       el('e-where-name').value.trim() || null,
      where_city_state: el('e-where-city').value.trim() || null,
      where_country:    el('e-where-country').value.trim() || null,
      when_text:        el('e-when').value.trim() || null,
      event_notes:      el('e-notes').value.trim() || null,
    };
    var res = await api('POST', { action: 'update_beer', beer_id: editingBeerId, updates: updates });
    if (res.status === 401) { closeEditModal(); location.href = '/'; return; }
    if (!res.ok) { el('editSaveStatus').textContent = 'error'; return; }
    var d = await res.json();
    el('editSaveStatus').textContent = 'saved';
    var idx = state.allBeers.findIndex(function (b) { return b.id === editingBeerId; });
    if (idx >= 0) { state.allBeers[idx] = d.updated_beer; renderTypeFilter(); renderFilterBar(); renderList(); }
  }

  // ── delete beer ───────────────────────────────────────────────────────────
  async function deleteBeer(beerId) {
    if (!confirm('remove this beer?')) return;
    var res = await api('POST', { action: 'delete_beer', beer_id: beerId });
    if (res.status === 401) { location.href = '/'; return; }
    if (!res.ok) { var d = await res.json(); alert(d.error || 'error'); return; }
    await loadData();
  }

  // ── comparison modal ──────────────────────────────────────────────────────
  function showComparison(newBeer, candidate) {
    state.newBeer = newBeer;
    el('cmpNewBrewery').textContent       = newBeer.brewery || '';
    el('cmpNewProduct').textContent       = newBeer.product || '';
    el('cmpNewType').textContent          = newBeer.type || '';
    el('cmpCandidateBrewery').textContent = candidate.brewery || '';
    el('cmpCandidateProduct').textContent = candidate.product || '';
    el('cmpCandidateType').textContent    = candidate.type || '';
    el('cmpModal').removeAttribute('hidden');
  }

  function hideCmpModal() { el('cmpModal').setAttribute('hidden', ''); }

  async function submitChoice(winner) {
    var sessionId = state.activeSession && state.activeSession.id;
    if (!sessionId) return;
    var res = await api('POST', { action: 'submit_choice', session_id: sessionId, winner: winner });
    if (res.status === 401) { hideCmpModal(); location.href = '/'; return; }
    var d = await res.json();
    if (!res.ok) { alert(d.error || 'error'); return; }
    if (d.completed) {
      hideCmpModal(); state.activeSession = null; await loadData();
    } else {
      state.activeSession.candidate_beer_id = d.next_comparison.candidate.id;
      showComparison(state.newBeer, d.next_comparison.candidate);
    }
  }

  async function cancelSession() {
    var sessionId = state.activeSession && state.activeSession.id;
    if (sessionId) await api('POST', { action: 'cancel_session', session_id: sessionId }).catch(function () {});
    state.activeSession = null;
    hideCmpModal();
  }

  // ── add beer modal ────────────────────────────────────────────────────────
  function openAddModal() {
    el('addForm').reset();
    el('addError').textContent = '';
    el('addModal').removeAttribute('hidden');
    el('f-brewery').focus();
  }

  function closeAddModal() { el('addModal').setAttribute('hidden', ''); }

  // ── load data ─────────────────────────────────────────────────────────────
  async function loadData() {
    var res = await api('GET');
    if (res.status === 401) { location.href = '/'; return; }
    if (res.status === 403) { el('beerList').innerHTML = '<p class="notice">access restricted</p>'; return; }
    if (!res.ok) { el('beerList').innerHTML = '<p class="notice">failed to load (' + res.status + ')</p>'; return; }
    var data = await res.json();
    var byType = data.beers_by_type || {};
    state.allBeers = [];
    Object.keys(byType).forEach(function (type) { state.allBeers = state.allBeers.concat(byType[type] || []); });
    state.activeSession = data.active_session || null;

    populateDataLists(state.allBeers);
    renderTypeFilter();
    renderFilterBar();
    renderList();

    if (state.activeSession && state.activeSession.candidate_beer) {
      state.newBeer = state.activeSession.new_beer;
      showComparison(state.activeSession.new_beer, state.activeSession.candidate_beer);
    }
  }

  // ── init ──────────────────────────────────────────────────────────────────
  async function init() {
    var meRes = await fetch('/auth/me');
    var me = await meRes.json();
    if (!me.loggedIn) { location.href = '/'; return; }

    el('logoutBtn').addEventListener('click', function () {
      fetch('/auth/logout', { method: 'POST' }).then(function () { location.href = '/'; });
    });



    // add modal
    el('addBeerBtn').addEventListener('click', openAddModal);
    el('addModalClose').addEventListener('click', closeAddModal);
    el('addCancel').addEventListener('click', closeAddModal);

    el('addForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      el('addError').textContent = '';
      el('addSubmit').disabled = true;
      var beer = {
        brewery:           el('f-brewery').value.trim(),
        product:           el('f-product').value.trim(),
        type:              el('f-type').value.trim(),
        sub_type:          el('f-sub-type').value.trim() || null,
        country_territory: el('f-country').value.trim() || null,
        where_name:        el('f-where-name').value.trim() || null,
        where_city_state:  el('f-where-city').value.trim() || null,
        where_country:     el('f-where-country').value.trim() || null,
        when_text:         el('f-when').value.trim() || null,
        event_notes:       el('f-notes').value.trim() || null,
      };
      var res = await api('POST', { action: 'create_beer', beer: beer });
      var d = await res.json();
      el('addSubmit').disabled = false;
      if (res.status === 401) { closeAddModal(); location.href = '/'; return; }
      if (!res.ok) { el('addError').textContent = d.error || 'error'; return; }
      closeAddModal();
      if (d.completed) {
        await loadData();
      } else {
        state.activeSession = { id: d.session_id, new_beer_id: d.created_beer.id };
        state.newBeer = d.created_beer;
        await loadData();
        showComparison(d.created_beer, d.next_comparison.candidate);
      }
    });

    // edit modal
    el('editModalClose').addEventListener('click', closeEditModal);
    el('editCancel').addEventListener('click', closeEditModal);
    ['e-brewery','e-product','e-type','e-sub-type','e-country',
     'e-where-name','e-where-city','e-where-country','e-when','e-notes'].forEach(function (id) {
      var input = el(id);
      if (input) input.addEventListener('input', scheduleAutoSave);
    });

    // comparison
    el('cmpCardNew').addEventListener('click', function () { submitChoice('new'); });
    el('cmpCardCandidate').addEventListener('click', function () { submitChoice('candidate'); });
    el('cmpCardNew').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') submitChoice('new'); });
    el('cmpCardCandidate').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') submitChoice('candidate'); });
    el('cmpCancel').addEventListener('click', cancelSession);

    await loadData();
  }

  init();
})();
