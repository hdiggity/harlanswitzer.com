const SKIP_LOG_PATHS = ['/collect', '/auth/', '/admin/api'];
const BOT_THRESHOLD  = 30;   // below this CF bot score = block

// Security headers added to every function response
const SEC_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'Permissions-Policy':      'camera=(), microphone=(), geolocation=()',
  // frame-ancestors replaces X-Frame-Options; 'unsafe-inline' needed for inline <script>/<style>
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

export async function onRequest(context) {
  const { request, env, next, waitUntil } = context;
  const url    = new URL(request.url);
  const path   = url.pathname;
  const method = request.method.toUpperCase();

  // ── bot score gate (skip /auth/ so legitimate logins are never blocked) ───
  if (!path.startsWith('/auth/')) {
    const score = request.cf?.botManagement?.score;
    if (score !== undefined && score < BOT_THRESHOLD) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // ── CSRF: for state-changing requests on sensitive paths ─────────────────
  // Check Sec-Fetch-Site (modern browsers) and Origin header (all browsers).
  // Blocks requests that originate from a different site.
  if (['POST', 'PATCH', 'DELETE'].includes(method)) {
    const sensitive = path.startsWith('/auth/') || path.startsWith('/admin/') || path.startsWith('/bests/');
    if (sensitive) {
      // Sec-Fetch-Site is injected by the browser and cannot be spoofed from another origin
      const sfs = request.headers.get('sec-fetch-site');
      if (sfs && sfs !== 'same-origin' && sfs !== 'same-site' && sfs !== 'none') {
        return new Response('Forbidden', { status: 403 });
      }

      // Origin header check for browsers that don't send Sec-Fetch-Site
      const origin = request.headers.get('origin');
      if (origin) {
        let originHost;
        try { originHost = new URL(origin).hostname; } catch { return new Response('Forbidden', { status: 403 }); }
        if (originHost !== url.hostname) {
          return new Response('Forbidden', { status: 403 });
        }
      }
    }
  }

  // ── logging skip + self-exclude cookie ────────────────────────────────────
  const skipLog    = SKIP_LOG_PATHS.some(p => path === p || path.startsWith(p));
  const cookie     = request.headers.get('cookie') || '';
  const selfExclude = /(?:^|;\s*)self_exclude=1/.test(cookie);

  // ── pass through ──────────────────────────────────────────────────────────
  const response = await next();

  // ── self-exclude toggle ───────────────────────────────────────────────────
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

  // ── request logging ───────────────────────────────────────────────────────
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

  // ── attach security headers to every function response ───────────────────
  return new Response(response.body, {
    status:  response.status,
    headers: withSecHeaders(response.headers),
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
