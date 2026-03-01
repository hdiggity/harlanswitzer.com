(function () {
  var currentUserId   = null;
  var currentSessId   = null;
  var targetUserId    = null;
  var sessionUserId   = null;
  var sessionUsername = null;

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts * 1000);
    return d.toISOString().slice(0, 10);
  }

  function fmtDateFull(ts) {
    if (!ts) return '—';
    var d = new Date(ts * 1000);
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' utc';
  }

  function post(body) {
    return fetch('/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  }

  // ── sessions modal ─────────────────────────────────────────────────────────

  function openSessModal(user) {
    sessionUserId   = user.id;
    sessionUsername = user.username;
    el('sessModalTitle').textContent = 'sessions — ' + user.username;
    renderSessionList(user.sessions);
    el('sessModal').removeAttribute('hidden');
  }

  function closeSessModal() {
    el('sessModal').setAttribute('hidden', '');
    sessionUserId = null;
  }

  function renderSessionList(sessions) {
    var list = el('sessList');
    if (!sessions || !sessions.length) {
      list.innerHTML = '<p class="no-sessions-msg">no active sessions</p>';
      return;
    }
    list.innerHTML = sessions.map(function (s) {
      var isCurrent = s.id === currentSessId;
      return '<div class="session-row' + (isCurrent ? ' current' : '') + '">' +
        '<div class="session-meta">' +
          '<span class="session-id">' + esc(s.id.slice(0, 8)) + '…' +
            (isCurrent ? '<span class="session-tag">this session</span>' : '') +
          '</span>' +
          '<span class="session-dates">created ' + esc(fmtDate(s.created_at)) +
            ' · expires ' + esc(fmtDate(s.expires_at)) + '</span>' +
        '</div>' +
        '<button class="btn-revoke" data-sid="' + esc(s.id) + '">' +
          (isCurrent ? 'revoke (logout)' : 'revoke') +
        '</button>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.btn-revoke').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = btn.dataset.sid;
        var isOwn = sid === currentSessId;
        var msg = isOwn
          ? 'revoke your current session? you will be logged out immediately.'
          : 'revoke this session?';
        if (!confirm(msg)) return;
        post({ action: 'revoke_session', session_id: sid })
          .then(function (res) {
            if (!res.ok) { alert(res.d.error || 'error'); return; }
            if (isOwn) { location.href = '/'; return; }
            load(function (users) {
              var updated = users.find(function (u) { return u.id === sessionUserId; });
              if (updated) renderSessionList(updated.sessions);
              else closeSessModal();
            });
          })
          .catch(function () { alert('network error'); });
      });
    });
  }

  el('sessModalClose').addEventListener('click', closeSessModal);
  el('sessModal').addEventListener('click', function (e) { if (e.target === el('sessModal')) closeSessModal(); });

  el('revokeAllBtn').addEventListener('click', function () {
    if (!sessionUserId) return;
    var isOwn = sessionUserId === currentUserId;
    var msg = isOwn
      ? 'revoke all your sessions? you will be logged out immediately.'
      : 'revoke all sessions for ' + sessionUsername + '?';
    if (!confirm(msg)) return;
    post({ action: 'revoke_all', user_id: sessionUserId })
      .then(function (res) {
        if (!res.ok) { alert(res.d.error || 'error'); return; }
        if (isOwn) { location.href = '/'; return; }
        closeSessModal();
        load();
      })
      .catch(function () { alert('network error'); });
  });

  // ── create user modal ──────────────────────────────────────────────────────

  function openCreateModal() {
    el('createForm').reset();
    el('createError').textContent = '';
    el('createSubmit').disabled = false;
    el('createModal').removeAttribute('hidden');
    el('createUsername').focus();
  }

  function closeCreateModal() { el('createModal').setAttribute('hidden', ''); }

  el('newUserBtn').addEventListener('click', openCreateModal);
  el('createModalClose').addEventListener('click', closeCreateModal);
  el('createCancel').addEventListener('click', closeCreateModal);
  el('createModal').addEventListener('click', function (e) { if (e.target === el('createModal')) closeCreateModal(); });

  el('createForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw  = el('createPw').value;
    var pw2 = el('createPwConfirm').value;
    el('createError').textContent = '';
    if (pw !== pw2) { el('createError').textContent = 'passwords do not match'; return; }
    el('createSubmit').disabled = true;
    post({ action: 'create_user', username: el('createUsername').value.trim(), password: pw })
      .then(function (res) {
        el('createSubmit').disabled = false;
        if (!res.ok) { el('createError').textContent = res.d.error || 'error'; return; }
        closeCreateModal();
        load();
      })
      .catch(function () { el('createSubmit').disabled = false; el('createError').textContent = 'network error'; });
  });

  // ── set password modal ─────────────────────────────────────────────────────

  function openPwModal(userId, username) {
    targetUserId = userId;
    el('pwModalTitle').textContent = 'set password — ' + username;
    el('pwForm').reset();
    el('pwError').textContent = '';
    el('pwSubmit').disabled = false;
    el('pwModal').removeAttribute('hidden');
    el('pwInput').focus();
  }

  function closePwModal() { el('pwModal').setAttribute('hidden', ''); targetUserId = null; }

  el('pwModalClose').addEventListener('click', closePwModal);
  el('pwCancel').addEventListener('click', closePwModal);
  el('pwModal').addEventListener('click', function (e) { if (e.target === el('pwModal')) closePwModal(); });

  el('pwForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw  = el('pwInput').value;
    var pw2 = el('pwConfirm').value;
    el('pwError').textContent = '';
    if (pw !== pw2) { el('pwError').textContent = 'passwords do not match'; return; }
    el('pwSubmit').disabled = true;
    fetch('/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: targetUserId, password: pw }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        el('pwSubmit').disabled = false;
        if (!res.ok) { el('pwError').textContent = res.d.error || 'error'; return; }
        closePwModal();
        load();
      })
      .catch(function () { el('pwSubmit').disabled = false; el('pwError').textContent = 'network error'; });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!el('createModal').hasAttribute('hidden')) closeCreateModal();
    else if (!el('pwModal').hasAttribute('hidden')) closePwModal();
    else if (!el('sessModal').hasAttribute('hidden')) closeSessModal();
  });

  // ── render table ───────────────────────────────────────────────────────────

  function render(users) {
    var wrap = el('userTable');
    if (!users || !users.length) {
      wrap.innerHTML = '<p class="notice">no users found</p>';
      return;
    }

    var html = '<table><thead><tr>' +
      '<th>username</th><th>created</th><th>sessions</th><th></th>' +
      '</tr></thead><tbody>';

    users.forEach(function (u) {
      var isSelf = u.id === currentUserId;
      var sessCount = u.sessions ? u.sessions.length : 0;
      var sessBtn = sessCount > 0
        ? '<button class="btn-session" data-uid="' + esc(u.id) + '">' + sessCount + '</button>'
        : '<span class="no-sessions">0</span>';

      html += '<tr>' +
        '<td>' + esc(u.username) + (isSelf ? ' <span style="font-size:10px;color:var(--muted)">(you)</span>' : '') + '</td>' +
        '<td>' + esc(fmtDate(u.created_at)) + '</td>' +
        '<td>' + sessBtn + '</td>' +
        '<td><div class="actions">' +
          '<button class="btn" data-action="pw" data-id="' + esc(u.id) + '" data-name="' + esc(u.username) + '">set password</button>' +
          (!isSelf
            ? '<button class="btn btn-danger" data-action="del" data-id="' + esc(u.id) + '" data-name="' + esc(u.username) + '">delete</button>'
            : '') +
        '</div></td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.btn-session').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var uid = Number(btn.dataset.uid);
        var user = users.find(function (u) { return u.id === uid; });
        if (user) openSessModal(user);
      });
    });

    wrap.querySelectorAll('[data-action="pw"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openPwModal(Number(btn.dataset.id), btn.dataset.name);
      });
    });

    wrap.querySelectorAll('[data-action="del"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirm('delete user "' + btn.dataset.name + '"? this cannot be undone.')) return;
        fetch('/admin/users', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: Number(btn.dataset.id) }),
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (res.ok) load();
            else alert(res.d.error || 'error');
          })
          .catch(function () { alert('network error'); });
      });
    });
  }

  // ── load ───────────────────────────────────────────────────────────────────

  var latestUsers = [];

  function load(cb) {
    fetch('/admin/users')
      .then(function (r) {
        if (r.status === 401) { location.href = '/'; return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        latestUsers = d.users || [];
        render(latestUsers);
        if (cb) cb(latestUsers);
      })
      .catch(function () {
        el('userTable').innerHTML = '<p class="notice">failed to load</p>';
      });
  }

  // ── init ───────────────────────────────────────────────────────────────────

  async function init() {
    var meRes = await fetch('/auth/me');
    var me    = await meRes.json();
    if (!me.loggedIn) { location.href = '/'; return; }

    currentUserId = me.user_id || null;
    currentSessId = me.session_id || null;

    el('logoutBtn').addEventListener('click', function () {
      fetch('/auth/logout', { method: 'POST' }).then(function () { location.href = '/'; });
    });

    load();
  }

  init();
})();
