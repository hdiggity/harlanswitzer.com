(function () {
  // respect self-exclude cookie
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? m[1] : null;
  }
  if (getCookie('self_exclude') === '1') return;

  var ENDPOINT = '/collect';
  var FLUSH_INTERVAL = 2000;
  var queue = [];
  var flushing = false;

  // visitor id (persistent) and session id (in-memory)
  var vid = localStorage.getItem('_vid');
  if (!vid) {
    vid = uuid();
    try { localStorage.setItem('_vid', vid); } catch (_) {}
  }
  var sid = uuid();

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function push(type, data) {
    queue.push({
      ts: Math.floor(Date.now() / 1000),
      vid: vid,
      sid: sid,
      type: type,
      path: location.pathname,
      data: data || null,
    });
  }

  function flush(sync) {
    if (!queue.length) return;
    var batch = queue.splice(0);
    if (sync && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, JSON.stringify(batch));
    } else {
      fetch(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(batch),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(function () {});
    }
  }

  // pageview
  push('pageview', null);

  // clicks (capture phase)
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a,button') : null;
    if (!el) return;
    var data = { tag: el.tagName.toLowerCase() };
    if (el.href) data.href = el.href;
    push('click', data);
  }, true);

  // outbound links
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !a.href) return;
    try {
      var url = new URL(a.href);
      if (url.hostname !== location.hostname) {
        push('outbound', { href: a.href });
      }
    } catch (_) {}
  }, true);

  // scroll depth
  var scrollMilestones = [10, 20, 40, 60, 80, 100];
  var scrollFired = {};
  function onScroll() {
    var el = document.documentElement;
    var scrolled = el.scrollTop + el.clientHeight;
    var total = el.scrollHeight;
    if (total <= 0) return;
    var pct = Math.round(scrolled / total * 100);
    scrollMilestones.forEach(function (m) {
      if (!scrollFired[m] && pct >= m) {
        scrollFired[m] = true;
        push('scroll_depth', { pct: m });
      }
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // errors
  window.addEventListener('error', function (e) {
    push('js_error', { msg: e.message, src: e.filename, line: e.lineno });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var msg = e.reason ? String(e.reason.message || e.reason) : 'unhandled rejection';
    push('unhandled_rejection', { msg: msg });
  });

  // perf timing (after load)
  window.addEventListener('load', function () {
    setTimeout(function () {
      try {
        var t = performance.timing;
        push('perf', {
          ttfb: t.responseStart - t.navigationStart,
          dom_ready: t.domContentLoadedEventEnd - t.navigationStart,
          load: t.loadEventEnd - t.navigationStart,
        });
      } catch (_) {}
    }, 0);
  });

  // periodic flush
  setInterval(function () { flush(false); }, FLUSH_INTERVAL);

  // flush on visibility change / pagehide
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', function () { flush(true); }, { capture: true });
})();
