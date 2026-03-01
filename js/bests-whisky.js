(function () {
  // ── state ─────────────────────────────────────────────────────────────────
  var state = {
    allWhiskies: [],
    activeSession: null,
    newWhisky: null,
    filterType: 'all',
    filters: { country: '', distillery: '', where: '' },
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

  function formatWhen(w) {
    if (w.when_ts) {
      var d = new Date(w.when_ts * 1000);
      return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
    }
    return w.when_text || '';
  }

  function api(method, body) {
    var opts = { method: method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch('/bests/whisky/api', opts);
  }

  // ── autocomplete datalists ────────────────────────────────────────────────
  function populateDataLists(whiskies) {
    var sets = { distillery: new Set(), type: new Set(), age: new Set(), country: new Set(),
                 where_name: new Set(), where_city: new Set(), where_country: new Set(), when: new Set() };
    whiskies.forEach(function (w) {
      if (w.distillery)        sets.distillery.add(w.distillery);
      if (w.type)              sets.type.add(w.type);
      if (w.age)               sets.age.add(w.age);
      if (w.country_territory) sets.country.add(stripEmoji(w.country_territory));
      if (w.where_name)        sets.where_name.add(w.where_name);
      if (w.where_city_state)  sets.where_city.add(w.where_city_state);
      if (w.where_country)     sets.where_country.add(w.where_country);
      if (w.when_text)         sets.when.add(w.when_text);
    });
    var map = { 'dl-distillery': sets.distillery, 'dl-type': sets.type, 'dl-age': sets.age,
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
    var types = Array.from(new Set(state.allWhiskies.map(function (w) { return w.type; }))).sort();
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
      ? state.allWhiskies
      : state.allWhiskies.filter(function (w) { return w.type === state.filterType; });

    var countries    = Array.from(new Set(base.map(function (w) { return stripEmoji(w.country_territory || ''); }).filter(Boolean))).sort();
    var distilleries = Array.from(new Set(base.map(function (w) { return w.distillery || ''; }).filter(Boolean))).sort();
    var wheres       = Array.from(new Set(base.map(function (w) { return w.where_city_state || ''; }).filter(Boolean))).sort();

    function combo(id, dlId, placeholder, opts, cur) {
      var dl = '<datalist id="' + dlId + '">' +
        opts.map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') +
        '</datalist>';
      return '<input class="filter-input" id="' + id + '" type="text" placeholder="' + placeholder +
        '" list="' + dlId + '" value="' + esc(cur) + '" autocomplete="off" />' + dl;
    }

    bar.innerHTML =
      combo('filterCountry',    'fb-country-list',    'country',    countries,    state.filters.country) +
      combo('filterDistillery', 'fb-distillery-list', 'distillery', distilleries, state.filters.distillery) +
      combo('filterWhere',      'fb-where-list',      'city',       wheres,       state.filters.where);

    bar.querySelectorAll('.filter-input').forEach(function (s) {
      s.addEventListener('input', function () {
        state.filters.country    = (el('filterCountry')    && el('filterCountry').value)    || '';
        state.filters.distillery = (el('filterDistillery') && el('filterDistillery').value) || '';
        state.filters.where      = (el('filterWhere')      && el('filterWhere').value)      || '';
        renderList();
      });
    });
  }

  // ── sorting ───────────────────────────────────────────────────────────────
  function sortValue(w, col) {
    switch (col) {
      case 'score':      return w.score != null ? w.score : -1;
      case 'product':    return (w.product || '').toLowerCase();
      case 'distillery': return (w.distillery || '').toLowerCase();
      case 'country':    return (w.country_territory || '').toLowerCase();
      case 'where':      return ([w.where_name, w.where_city_state, w.where_country].filter(Boolean).join(', ')).toLowerCase();
      case 'when':       return w.when_ts != null ? w.when_ts : -Infinity;
      default:           return '';
    }
  }

  function filteredAndSorted() {
    var whiskies = state.allWhiskies.slice();
    if (state.filterType !== 'all') whiskies = whiskies.filter(function (w) { return w.type === state.filterType; });
    if (state.filters.country) {
      var fc = state.filters.country.toLowerCase();
      whiskies = whiskies.filter(function (w) { return w.country_territory && stripEmoji(w.country_territory).toLowerCase().includes(fc); });
    }
    if (state.filters.distillery) {
      var fd = state.filters.distillery.toLowerCase();
      whiskies = whiskies.filter(function (w) { return w.distillery && w.distillery.toLowerCase().includes(fd); });
    }
    if (state.filters.where) {
      var fw = state.filters.where.toLowerCase();
      whiskies = whiskies.filter(function (w) { return w.where_city_state && w.where_city_state.toLowerCase().includes(fw); });
    }
    var col = state.sortCol, dir = state.sortDir;
    whiskies.sort(function (a, b) {
      var av = sortValue(a, col), bv = sortValue(b, col);
      var cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
    return whiskies;
  }

  // ── table render ──────────────────────────────────────────────────────────
  var COLS = [
    { id: 'score',      label: 'score'      },
    { id: 'product',    label: 'product'    },
    { id: 'distillery', label: 'distillery' },
    { id: 'country',    label: 'country'    },
    { id: 'where',      label: 'where'      },
    { id: 'when',       label: 'when'       },
  ];

  function arrow(col) {
    if (state.sortCol !== col) return '';
    return '<span class="sort-arrow">' + (state.sortDir === 'asc' ? '▲' : '▼') + '</span>';
  }

  function renderList() {
    var listEl = el('whiskyList');
    if (!listEl) return;
    var whiskies = filteredAndSorted();
    if (!whiskies.length) {
      listEl.innerHTML = '<p class="notice">no whiskies match the current filters</p>';
      return;
    }

    var thead = '<thead><tr>' +
      COLS.map(function (c) {
        var active = state.sortCol === c.id ? ' sort-active' : '';
        return '<th class="sortable' + active + '" data-col="' + c.id + '">' + c.label + arrow(c.id) + '</th>';
      }).join('') +
      '<th></th></tr></thead>';

    var tbody = '<tbody>' + whiskies.map(function (w) {
      var score = w.score != null
        ? '<span class="score-val">' + w.score.toFixed(1) + '</span>'
        : '<span class="score-null">—</span>';
      var product = esc(w.product) + (w.age ? '<div class="cell-sub">' + esc(w.age) + '</div>' : '');
      var where = [w.where_name, w.where_city_state, w.where_country].filter(Boolean).join(', ');
      return '<tr>' +
        '<td>' + score + '</td>' +
        '<td>' + product + '</td>' +
        '<td>' + esc(w.distillery) + '</td>' +
        '<td>' + esc(stripEmoji(w.country_territory || '')) + '</td>' +
        '<td>' + esc(where) + '</td>' +
        '<td>' + esc(formatWhen(w)) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn-edit"   data-id="' + w.id + '">edit</button>' +
          '<button class="btn-remove" data-id="' + w.id + '">remove</button>' +
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
        var whisky = state.allWhiskies.find(function (w) { return w.id === parseInt(btn.dataset.id, 10); });
        if (whisky) openEditModal(whisky);
      });
    });

    listEl.querySelectorAll('.btn-remove').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteWhisky(parseInt(btn.dataset.id, 10)); });
    });
  }

  // ── edit modal ────────────────────────────────────────────────────────────
  var editDebounceTimer = null;
  var editingWhiskyId = null;

  function openEditModal(whisky) {
    editingWhiskyId = whisky.id;
    el('e-distillery').value    = whisky.distillery || '';
    el('e-product').value       = whisky.product || '';
    el('e-type').value          = whisky.type || '';
    el('e-age').value           = whisky.age || '';
    el('e-country').value       = stripEmoji(whisky.country_territory || '');
    el('e-where-name').value    = whisky.where_name || '';
    el('e-where-city').value    = whisky.where_city_state || '';
    el('e-where-country').value = whisky.where_country || '';
    el('e-when').value          = whisky.when_text || '';
    el('e-notes').value         = whisky.notes || '';
    el('editSaveStatus').textContent = '';
    el('editModal').removeAttribute('hidden');
    el('e-distillery').focus();
  }

  function closeEditModal() {
    el('editModal').setAttribute('hidden', '');
    clearTimeout(editDebounceTimer);
    editingWhiskyId = null;
  }

  function scheduleAutoSave() {
    clearTimeout(editDebounceTimer);
    el('editSaveStatus').textContent = 'saving…';
    editDebounceTimer = setTimeout(autoSave, 700);
  }

  async function autoSave() {
    if (!editingWhiskyId) return;
    var updates = {
      distillery:        el('e-distillery').value.trim(),
      product:           el('e-product').value.trim(),
      type:              el('e-type').value.trim(),
      age:               el('e-age').value.trim() || null,
      country_territory: el('e-country').value.trim() || null,
      where_name:        el('e-where-name').value.trim() || null,
      where_city_state:  el('e-where-city').value.trim() || null,
      where_country:     el('e-where-country').value.trim() || null,
      when_text:         el('e-when').value.trim() || null,
      notes:             el('e-notes').value.trim() || null,
    };
    var res = await api('POST', { action: 'update_whisky', whisky_id: editingWhiskyId, updates: updates });
    if (res.status === 401) { closeEditModal(); location.href = '/'; return; }
    if (!res.ok) { el('editSaveStatus').textContent = 'error'; return; }
    var d = await res.json();
    el('editSaveStatus').textContent = 'saved';
    var idx = state.allWhiskies.findIndex(function (w) { return w.id === editingWhiskyId; });
    if (idx >= 0) {
      var typeChanged = state.allWhiskies[idx].type !== d.updated_whisky.type;
      state.allWhiskies[idx] = d.updated_whisky;
      if (typeChanged) { await loadData(); } else { renderTypeFilter(); renderFilterBar(); renderList(); }
    }
  }

  // ── delete whisky ─────────────────────────────────────────────────────────
  async function deleteWhisky(whiskyId) {
    if (!confirm('remove this whisky?')) return;
    var res = await api('POST', { action: 'delete_whisky', whisky_id: whiskyId });
    if (res.status === 401) { location.href = '/'; return; }
    if (!res.ok) { var d = await res.json(); alert(d.error || 'error'); return; }
    await loadData();
  }

  // ── comparison modal ──────────────────────────────────────────────────────
  function showComparison(newWhisky, candidate) {
    state.newWhisky = newWhisky;
    el('cmpNewDistillery').textContent       = newWhisky.distillery || '';
    el('cmpNewProduct').textContent          = newWhisky.product || '';
    el('cmpNewType').textContent             = newWhisky.type || '';
    el('cmpCandidateDistillery').textContent = candidate.distillery || '';
    el('cmpCandidateProduct').textContent    = candidate.product || '';
    el('cmpCandidateType').textContent       = candidate.type || '';
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
      state.activeSession.candidate_whisky_id = d.next_comparison.candidate.id;
      showComparison(state.newWhisky, d.next_comparison.candidate);
    }
  }

  async function cancelSession() {
    var sessionId = state.activeSession && state.activeSession.id;
    if (sessionId) await api('POST', { action: 'cancel_session', session_id: sessionId }).catch(function () {});
    state.activeSession = null;
    hideCmpModal();
  }

  // ── add whisky modal ──────────────────────────────────────────────────────
  function openAddModal() {
    el('addForm').reset();
    el('addError').textContent = '';
    el('addModal').removeAttribute('hidden');
    el('f-distillery').focus();
  }

  function closeAddModal() { el('addModal').setAttribute('hidden', ''); }

  // ── load data ─────────────────────────────────────────────────────────────
  async function loadData() {
    var res = await api('GET');
    if (res.status === 401) { location.href = '/'; return; }
    if (res.status === 403) { el('whiskyList').innerHTML = '<p class="notice">access restricted</p>'; return; }
    if (!res.ok) { el('whiskyList').innerHTML = '<p class="notice">failed to load (' + res.status + ')</p>'; return; }
    var data = await res.json();
    var byType = data.whiskies_by_type || {};
    state.allWhiskies = [];
    Object.keys(byType).forEach(function (type) { state.allWhiskies = state.allWhiskies.concat(byType[type] || []); });
    state.activeSession = data.active_session || null;

    populateDataLists(state.allWhiskies);
    renderTypeFilter();
    renderFilterBar();
    renderList();

    if (state.activeSession && state.activeSession.candidate_whisky) {
      state.newWhisky = state.activeSession.new_whisky;
      showComparison(state.activeSession.new_whisky, state.activeSession.candidate_whisky);
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
    el('addWhiskyBtn').addEventListener('click', openAddModal);
    el('addModalClose').addEventListener('click', closeAddModal);
    el('addCancel').addEventListener('click', closeAddModal);

    el('addForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      el('addError').textContent = '';
      el('addSubmit').disabled = true;
      var whisky = {
        distillery:        el('f-distillery').value.trim(),
        product:           el('f-product').value.trim(),
        type:              el('f-type').value.trim(),
        age:               el('f-age').value.trim() || null,
        country_territory: el('f-country').value.trim() || null,
        where_name:        el('f-where-name').value.trim() || null,
        where_city_state:  el('f-where-city').value.trim() || null,
        where_country:     el('f-where-country').value.trim() || null,
        when_text:         el('f-when').value.trim() || null,
        notes:             el('f-notes').value.trim() || null,
      };
      var res = await api('POST', { action: 'create_whisky', whisky: whisky });
      var d = await res.json();
      el('addSubmit').disabled = false;
      if (res.status === 401) { closeAddModal(); location.href = '/'; return; }
      if (!res.ok) { el('addError').textContent = d.error || 'error'; return; }
      closeAddModal();
      if (d.completed) {
        await loadData();
      } else {
        state.activeSession = { id: d.session_id, new_whisky_id: d.created_whisky.id };
        state.newWhisky = d.created_whisky;
        await loadData();
        showComparison(d.created_whisky, d.next_comparison.candidate);
      }
    });

    // edit modal
    el('editModalClose').addEventListener('click', closeEditModal);
    el('editCancel').addEventListener('click', closeEditModal);
    ['e-distillery','e-product','e-type','e-age','e-country',
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
