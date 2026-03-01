(function () {
  var targetUserId = null;

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toISOString().slice(0, 10);
  }

  // ── password modal ────────────────────────────────────────────────────────

  var pwModal = el('pwModal');
  var pwForm  = el('pwForm');
  var pwError = el('pwError');

  function openPwModal(userId, username) {
    targetUserId = userId;
    el('pwModalTitle').textContent = 'set password — ' + username;
    el('pwInput').value = '';
    el('pwConfirm').value = '';
    pwError.textContent = '';
    pwModal.removeAttribute('hidden');
    el('pwInput').focus();
  }

  function closePwModal() {
    pwModal.setAttribute('hidden', '');
    targetUserId = null;
  }

  el('pwModalClose').addEventListener('click', closePwModal);
  el('pwCancel').addEventListener('click', closePwModal);
  pwModal.addEventListener('click', function (e) { if (e.target === pwModal) closePwModal(); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !pwModal.hasAttribute('hidden')) closePwModal();
  });

  pwForm.addEventListener('submit', function (e) {
    e.preventDefault();
    pwError.textContent = '';
    var pw  = el('pwInput').value;
    var pw2 = el('pwConfirm').value;
    if (pw !== pw2) { pwError.textContent = 'passwords do not match'; return; }

    fetch('/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: targetUserId, password: pw }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok) { closePwModal(); }
        else { pwError.textContent = res.d.error || 'error'; }
      })
      .catch(function (err) { pwError.textContent = err.message || 'network error'; });
  });

  // ── render table ──────────────────────────────────────────────────────────

  function render(users, currentUserId) {
    var wrap = el('userTable');
    if (!users || !users.length) {
      wrap.innerHTML = '<p class="notice">no users found</p>';
      return;
    }

    var html = '<table><thead><tr>' +
      '<th>username</th><th>created</th><th>active sessions</th><th></th>' +
      '</tr></thead><tbody>';

    users.forEach(function (u) {
      var isSelf = u.id === currentUserId;
      html += '<tr>' +
        '<td>' + esc(u.username) + (isSelf ? ' <span style="font-size:10px;color:var(--muted)">(you)</span>' : '') + '</td>' +
        '<td>' + esc(fmtDate(u.created_at)) + '</td>' +
        '<td><span class="badge-sessions">' + esc(u.active_sessions) + '</span></td>' +
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
            if (res.ok) { load(); }
            else { alert(res.d.error || 'error'); }
          })
          .catch(function (err) { alert(err.message || 'network error'); });
      });
    });
  }

  // ── load ──────────────────────────────────────────────────────────────────

  var currentUserId = null;

  function load() {
    fetch('/admin/users')
      .then(function (r) {
        if (!r.ok) { location.href = '/'; return null; }
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        render(d.users, currentUserId);
      })
      .catch(function () {
        el('userTable').innerHTML = '<p class="notice">failed to load</p>';
      });
  }

  // ── init ──────────────────────────────────────────────────────────────────

  async function init() {
    var meRes = await fetch('/auth/me');
    var me    = await meRes.json();
    if (!me.loggedIn) { location.href = '/'; return; }

    currentUserId = me.user_id || null;

    el('logoutBtn').addEventListener('click', function () {
      fetch('/auth/logout', { method: 'POST' }).then(function () { location.href = '/'; });
    });

    load();
  }

  init();
})();
