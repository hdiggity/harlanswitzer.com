import { verifySession } from '../_auth.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isAllowed(username, env) {
  const raw = env.TRADING_CARDS_ALLOWED_USERS || '';
  if (!raw.trim()) return false;
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    .includes(username.toLowerCase());
}

export async function onRequest(context) {
  const { request, env, params } = context;

  const pathParts = Array.isArray(params.path) ? params.path : [];
  const pathStr = pathParts.length > 0 ? '/' + pathParts.join('/') : '/';
  const isStaticAsset = pathStr.startsWith('/static/') || pathStr === '/favicon.ico' ||
    pathStr === '/manifest.json' || pathStr === '/logo192.png' || pathStr === '/logo512.png' ||
    pathStr === '/asset-manifest.json';

  // auth: require valid session for all requests
  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  if (!isStaticAsset) {
    const user = await env.db.prepare(
      'SELECT id, username FROM users WHERE id = ?'
    ).bind(session.user_id).first();
    if (!user) return json({ error: 'unauthorized' }, 401);
    if (!isAllowed(user.username, env)) return json({ error: 'forbidden' }, 403);
  }

  const origin = env.TRADING_CARDS_ORIGIN;
  if (!origin) return json({ error: 'origin not configured' }, 500);
  const url = new URL(request.url);
  const targetUrl = origin.replace(/\/$/, '') + pathStr + url.search;

  // forward headers, inject proxy secret
  const headers = new Headers(request.headers);
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
    console.error('[trading-cards proxy] fetch error:', err);
    return json({ error: 'origin unreachable' }, 502);
  }

  const respHeaders = new Headers(resp.headers);
  if (pathStr.startsWith('/static/')) {
    respHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (isStaticAsset) {
    respHeaders.set('Cache-Control', 'public, max-age=3600');
  } else {
    respHeaders.set('Cache-Control', 'no-store');
  }
  // remove hop-by-hop headers
  respHeaders.delete('transfer-encoding');
  respHeaders.delete('connection');

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}
