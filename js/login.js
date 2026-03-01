(function () {
    var btn = document.getElementById('loginBtn');
    var modal = document.getElementById('loginModal');
    var form = document.getElementById('loginForm');
    var closeBtn = document.getElementById('loginModalClose');
    var errorMsg = document.getElementById('loginError');

    var signupBtn = document.getElementById('signupBtn');
    var signupModal = document.getElementById('signupModal');
    var signupForm = document.getElementById('signupForm');
    var signupCloseBtn = document.getElementById('signupModalClose');
    var signupError = document.getElementById('signupError');

    if (!btn || !modal) return;

    // check auth state
    fetch('/auth/me')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.loggedIn) {
          btn.textContent = 'login';
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

    function closeLogin() {
      modal.setAttribute('hidden', '');
      if (errorMsg) errorMsg.textContent = '';
    }

    if (closeBtn) closeBtn.addEventListener('click', closeLogin);

    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeLogin();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!modal.hasAttribute('hidden')) closeLogin();
        if (signupModal && !signupModal.hasAttribute('hidden')) closeSignup();
      }
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
            return r.text().then(function (text) {
              var msg = 'error ' + r.status;
              try { msg = JSON.parse(text).error || msg; } catch (_) {}
              if (errorMsg) errorMsg.textContent = msg;
            });
          }
        })
        .catch(function (err) {
          if (errorMsg) errorMsg.textContent = err && err.message ? err.message : 'network error';
        });
    });

    // signup
    if (!signupBtn || !signupModal || !signupForm) return;

    function closeSignup() {
      signupModal.setAttribute('hidden', '');
      if (signupError) signupError.textContent = '';
    }

    signupBtn.addEventListener('click', function (e) {
      e.preventDefault();
      signupModal.removeAttribute('hidden');
      var input = signupForm.querySelector('input[name="username"]');
      if (input) input.focus();
    });

    if (signupCloseBtn) signupCloseBtn.addEventListener('click', closeSignup);

    signupModal.addEventListener('click', function (e) {
      if (e.target === signupModal) closeSignup();
    });

    signupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (signupError) signupError.textContent = '';
      var username = signupForm.querySelector('input[name="username"]').value.trim();
      var password = signupForm.querySelector('input[name="password"]').value;
      var confirm  = signupForm.querySelector('input[name="confirm"]').value;

      if (password !== confirm) {
        if (signupError) signupError.textContent = 'passwords do not match';
        return;
      }

      fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password }),
      })
        .then(function (r) {
          if (r.ok) {
            // auto-login after registration
            return fetch('/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: username, password: password }),
            }).then(function (lr) {
              if (lr.ok) {
                location.href = '/admin.html';
              } else {
                closeSignup();
                modal.removeAttribute('hidden');
              }
            });
          } else {
            return r.text().then(function (text) {
              var msg = 'error ' + r.status;
              try { msg = JSON.parse(text).error || msg; } catch (_) {}
              if (signupError) signupError.textContent = msg;
            });
          }
        })
        .catch(function (err) {
          if (signupError) signupError.textContent = err && err.message ? err.message : 'network error';
        });
    });
})();
