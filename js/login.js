(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('loginBtn');
    var modal = document.getElementById('loginModal');
    var form = document.getElementById('loginForm');
    var closeBtn = document.getElementById('loginModalClose');
    var errorMsg = document.getElementById('loginError');

    if (!btn || !modal) return;

    // check auth state
    fetch('/auth/me')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.loggedIn) {
          btn.textContent = 'stats';
          btn.dataset.loggedIn = '1';
        }
      })
      .catch(function () {});

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (btn.dataset.loggedIn === '1') {
        location.href = '/admin.html';
      } else {
        modal.removeAttribute('hidden');
        var input = form.querySelector('input[name="username"]');
        if (input) input.focus();
      }
    });

    function closeModal() {
      modal.setAttribute('hidden', '');
      if (errorMsg) errorMsg.textContent = '';
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hasAttribute('hidden')) closeModal();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (errorMsg) errorMsg.textContent = '';
      var username = form.querySelector('input[name="username"]').value.trim();
      var password = form.querySelector('input[name="password"]').value;

      fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      })
        .then(function (r) {
          if (r.ok) {
            location.href = '/admin.html';
          } else {
            return r.json().then(function (d) {
              if (errorMsg) errorMsg.textContent = d.error || 'login failed';
            });
          }
        })
        .catch(function () {
          if (errorMsg) errorMsg.textContent = 'network error';
        });
    });
  });
})();
