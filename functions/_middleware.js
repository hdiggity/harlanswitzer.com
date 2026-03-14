import { verifySession } from './_auth.js';

const MAIN_HOST  = 'harlanswitzer.com';
const BESTS_HOST = 'bests.harlanswitzer.com';
const CARDS_HOST = 'trading-cards.harlanswitzer.com';
const SPAM_HOST  = 'email-spam.harlanswitzer.com';

const SKIP_LOG_PATHS = ['/collect', '/auth/', '/admin/api'];
const BOT_THRESHOLD  = 30;

const SEC_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'Permissions-Policy':      'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

export async function onRequest(context) {
  const { request, env, next, waitUntil } = context;
  const url  = new URL(request.url);
  const host = url.hostname;

  // ── subdomain routing ─────────────────────────────────────────────────────
  if (host === BESTS_HOST) return handleBests(request, env, next, url);
  if (host === CARDS_HOST) return handleCards(request, env, url);
  if (host === SPAM_HOST)  return handleSpam(request, env, next, url);

  // ── main domain: redirect old paths to subdomains ─────────────────────────
  const path   = url.pathname;
  const method = request.method.toUpperCase();

  if (path === '/bests' || path.startsWith('/bests/')) {
    const sub = path.replace(/^\/bests\/?/, '/') || '/';
    return Response.redirect('https://' + BESTS_HOST + sub + url.search, 301);
  }
  if (path === '/trading-cards' || path.startsWith('/trading-cards/')) {
    const sub = path.replace(/^\/trading-cards\/?/, '/') || '/';
    return Response.redirect('https://' + CARDS_HOST + sub + url.search, 301);
  }
  if (path === '/email-spam' || path.startsWith('/email-spam/')) {
    const sub = path.replace(/^\/email-spam\/?/, '/') || '/';
    return Response.redirect('https://' + SPAM_HOST + sub + url.search, 301);
  }

  // ── bot score gate ────────────────────────────────────────────────────────
  if (!path.startsWith('/auth/')) {
    const score = request.cf?.botManagement?.score;
    if (score !== undefined && score < BOT_THRESHOLD) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // ── CSRF ──────────────────────────────────────────────────────────────────
  if (['POST', 'PATCH', 'DELETE'].includes(method)) {
    const sensitive = path.startsWith('/auth/') || path.startsWith('/admin/');
    if (sensitive) {
      const sfs = request.headers.get('sec-fetch-site');
      if (sfs && sfs !== 'same-origin' && sfs !== 'same-site' && sfs !== 'none') {
        return new Response('Forbidden', { status: 403 });
      }
      const origin = request.headers.get('origin');
      if (origin) {
        let originHost;
        try { originHost = new URL(origin).hostname; } catch { return new Response('Forbidden', { status: 403 }); }
        if (originHost !== url.hostname) return new Response('Forbidden', { status: 403 });
      }
    }
  }

  const skipLog     = SKIP_LOG_PATHS.some(p => path === p || path.startsWith(p));
  const cookie      = request.headers.get('cookie') || '';
  const selfExclude = /(?:^|;\s*)self_exclude=1/.test(cookie);

  const response = await next();

  const selfParam = url.searchParams.get('self');
  if (selfParam === '1' || selfParam === '0') {
    const headers = withSecHeaders(response.headers);
    if (selfParam === '1') {
      headers.append('Set-Cookie', 'self_exclude=1; Path=/; Max-Age=31536000; SameSite=Lax');
    } else {
      headers.append('Set-Cookie', 'self_exclude=0; Path=/; Max-Age=0; SameSite=Lax');
    }
    return new Response(response.body, { status: response.status, headers });
  }

  if (!skipLog && !selfExclude && env.db) {
    const cf     = request.cf || {};
    const ip     = request.headers.get('cf-connecting-ip') || '';
    const ipHash = ip ? await sha256Hex((env.IP_HASH_SALT || '') + ip) : '';
    waitUntil(
      env.db.prepare(
        `INSERT INTO requests (ts,host,path,method,status,country,asn,colo,user_agent,referer,ray,bot_score,verified_bot,ip_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        Math.floor(Date.now() / 1000),
        url.hostname, path, method,
        response.status,
        cf.country || null, cf.asn ? String(cf.asn) : null, cf.colo || null,
        request.headers.get('user-agent') || null,
        request.headers.get('referer')    || null,
        request.headers.get('cf-ray')     || null,
        cf.botManagement?.score ?? null,
        cf.botManagement?.verifiedBot ? 1 : 0,
        ipHash || null
      ).run()
    );
  }

  return new Response(response.body, {
    status:  response.status,
    headers: withSecHeaders(response.headers),
  });
}

// ── bests subdomain ───────────────────────────────────────────────────────────
async function handleBests(request, env, next, url) {
  const path = url.pathname;

  // static assets and existing function paths pass through (functions have own auth)
  const isPassThrough =
    /\.(js|css|png|ico|woff2?|svg|webp|jpg|jpeg|gif|map)$/.test(path) ||
    path.startsWith('/js/')     || path.startsWith('/css/')    ||
    path.startsWith('/styles/') || path.startsWith('/auth/')   ||
    path.startsWith('/bests/')  || path.startsWith('/collect') ||
    path.startsWith('/admin/');

  if (isPassThrough) {
    const resp = await next();
    return new Response(resp.body, { status: resp.status, headers: withSecHeaders(resp.headers) });
  }

  // all other requests require auth — redirect to main domain login if missing
  const session = await verifySession(request, env);
  if (!session) {
    return Response.redirect(
      'https://' + MAIN_HOST + '/?redirect=' + encodeURIComponent(request.url), 302
    );
  }

  // rewrite root and short paths to the actual HTML assets
  const rewrites = {
    '/':            '/bests/index.html',
    '/index.html':  '/bests/index.html',
    '/beer':        '/bests/beer.html',
    '/beer.html':   '/bests/beer.html',
    '/whisky':      '/bests/whisky.html',
    '/whisky.html': '/bests/whisky.html',
  };

  const assetPath = rewrites[path];
  if (assetPath) {
    const assetUrl = new URL(request.url);
    assetUrl.hostname = MAIN_HOST;
    assetUrl.pathname = assetPath;
    const resp = await env.ASSETS.fetch(
      new Request(assetUrl.toString(), { method: 'GET', headers: request.headers })
    );
    return new Response(resp.body, { status: resp.status, headers: withSecHeaders(resp.headers) });
  }

  const resp = await next();
  return new Response(resp.body, { status: resp.status, headers: withSecHeaders(resp.headers) });
}

// ── trading-cards subdomain ───────────────────────────────────────────────────
async function handleCards(request, env, url) {
  // public static assets — CRA JS/CSS bundles, icons, manifests, robots.txt
  // these don't require auth (browser loads them before React initialises)
  const isPublicStatic =
    url.pathname.startsWith('/static/') ||
    /\.(js|css|png|ico|woff2?|svg|webp|jpg|jpeg|gif|map|json|txt)$/.test(url.pathname);

  // SPA html routes — everything that isn't an API or image call
  const isSpaRoute =
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/cards/') &&
    !url.pathname.startsWith('/health');

  const session = await verifySession(request, env);

  // public static assets: proxy to vm (no auth required; vm auto-authenticates via proxy secret)
  // note: NOT served from ASSETS because forwarding Accept-Encoding headers to env.ASSETS.fetch()
  // causes a content-encoding mismatch when the body is re-wrapped in new Response()
  if (isPublicStatic) {
    const origin = env.TRADING_CARDS_ORIGIN;
    if (!origin) return jsonResp({ error: 'origin not configured' }, 500);
    const targetUrl = origin.replace(/\/$/, '') + url.pathname + url.search;
    const headers = new Headers(request.headers);
    headers.set('X-Trading-Proxy-Secret', env.TRADING_CARDS_PROXY_SECRET || '');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ray');
    headers.delete('cf-ipcountry');
    headers.delete('cf-visitor');
    let resp;
    try {
      resp = await fetch(targetUrl, { method: 'GET', headers });
    } catch (err) {
      console.error('[cards proxy] static fetch error:', err);
      return jsonResp({ error: 'origin unreachable' }, 502);
    }
    const respHeaders = new Headers(resp.headers);
    if (url.pathname.startsWith('/static/')) {
      respHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      respHeaders.set('Cache-Control', 'public, max-age=3600');
    }
    respHeaders.delete('transfer-encoding');
    respHeaders.delete('connection');
    return new Response(resp.body, { status: resp.status, headers: respHeaders });
  }

  // all other requests require a valid session
  if (!session) {
    const acceptsHtml = (request.headers.get('accept') || '').includes('text/html');
    if (acceptsHtml) {
      return Response.redirect(
        'https://' + MAIN_HOST + '/?redirect=' + encodeURIComponent(request.url), 302
      );
    }
    return jsonResp({ error: 'unauthorized' }, 401);
  }

  // check that the user is in the allowed list
  const user = await env.db.prepare('SELECT id, username FROM users WHERE id = ?')
    .bind(session.user_id).first();
  if (!user) return jsonResp({ error: 'unauthorized' }, 401);
  if (!isAllowed(user.username, env)) return jsonResp({ error: 'forbidden' }, 403);

  // SPA routes (incl. root): serve index.html from cloudflare pages edge (no vm round-trip)
  // use a clean request with no Accept-Encoding to avoid content-encoding issues when re-wrapping
  if (isSpaRoute) {
    const assetUrl = new URL(request.url);
    assetUrl.hostname = MAIN_HOST;
    assetUrl.pathname = '/trading-cards/index.html';
    const resp = await env.ASSETS.fetch(
      new Request(assetUrl.toString(), { method: 'GET' })
    );
    const respHeaders = new Headers(resp.headers);
    respHeaders.set('Cache-Control', 'no-store');
    // override the _headers CSP to allow google fonts and cloudflare beacon
    respHeaders.set('Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: blob:; manifest-src 'self'; frame-ancestors 'none'");
    return new Response(resp.body, { status: resp.status, headers: respHeaders });
  }

  // /api/*, /cards/*, /health* — proxy to vm
  const origin = env.TRADING_CARDS_ORIGIN;
  if (!origin) return jsonResp({ error: 'origin not configured' }, 500);

  const targetUrl = origin.replace(/\/$/, '') + url.pathname + url.search;
  const headers   = new Headers(request.headers);
  headers.set('X-Trading-Proxy-Secret', env.TRADING_CARDS_PROXY_SECRET || '');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ray');
  headers.delete('cf-ipcountry');
  headers.delete('cf-visitor');

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  let resp;
  try {
    resp = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? request.body : null,
      ...(hasBody ? { duplex: 'half' } : {}),
    });
  } catch (err) {
    console.error('[cards proxy] fetch error:', err);
    return jsonResp({ error: 'origin unreachable' }, 502);
  }

  const respHeaders = new Headers(resp.headers);
  respHeaders.set('Cache-Control', 'no-store');
  respHeaders.delete('transfer-encoding');
  respHeaders.delete('connection');

  return new Response(resp.body, { status: resp.status, headers: respHeaders });
}

// ── email-spam subdomain ──────────────────────────────────────────────────
async function handleSpam(request, env, next, url) {
  const path = url.pathname;

  const isPassThrough =
    /\.(js|css|png|ico|woff2?|svg|webp|jpg|jpeg|gif|map)$/.test(path) ||
    path.startsWith('/auth/') || path.startsWith('/collect');

  if (isPassThrough) {
    const resp = await next();
    return new Response(resp.body, { status: resp.status, headers: withSecHeaders(resp.headers) });
  }

  const session = await verifySession(request, env);
  if (!session) {
    return Response.redirect(
      'https://' + MAIN_HOST + '/?redirect=' + encodeURIComponent(request.url), 302
    );
  }

  // API routes handled by CF Functions — pass through
  if (path.startsWith('/api/')) {
    const resp = await next();
    return new Response(resp.body, { status: resp.status, headers: withSecHeaders(resp.headers) });
  }

  // rewrite root to index.html
  const rewrites = {
    '/':           '/email-spam/index.html',
    '/index.html': '/email-spam/index.html',
  };

  const assetPath = rewrites[path];
  if (assetPath) {
    const assetUrl = new URL(request.url);
    assetUrl.hostname = MAIN_HOST;
    assetUrl.pathname = assetPath;
    const resp = await env.ASSETS.fetch(
      new Request(assetUrl.toString(), { method: 'GET', headers: request.headers })
    );
    return new Response(resp.body, { status: resp.status, headers: withSecHeaders(resp.headers) });
  }

  const resp = await next();
  return new Response(resp.body, { status: resp.status, headers: withSecHeaders(resp.headers) });
}

// ── helpers ───────────────────────────────────────────────────────────────────
function isAllowed(username, env) {
  const raw = env.TRADING_CARDS_ALLOWED_USERS || '';
  if (!raw.trim()) return false;
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    .includes(username.toLowerCase());
}

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withSecHeaders(existing) {
  const h = new Headers(existing);
  for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
  return h;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
