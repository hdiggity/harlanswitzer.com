const SKIP_PATHS = ['/collect', '/auth/', '/admin/api'];
const BOT_SCORE_THRESHOLD = 30; // below this = block (1=bot, 99=human)

export async function onRequest(context) {
  const { request, env, next, waitUntil } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // block low bot-score traffic — skip /auth/ so login is never blocked
  if (!path.startsWith('/auth/')) {
    const score = request.cf?.botManagement?.score;
    if (score !== undefined && score < BOT_SCORE_THRESHOLD) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // skip logging for these paths to avoid noise/loops
  const skip = SKIP_PATHS.some(p => path === p || path.startsWith(p));

  // self-exclude cookie check
  const cookie = request.headers.get('cookie') || '';
  const selfExclude = /(?:^|;\s*)self_exclude=1/.test(cookie);

  // pass through and capture response
  const response = await next();

  // handle ?self= param — mutate response headers
  const selfParam = url.searchParams.get('self');
  if (selfParam === '1') {
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', 'self_exclude=1; Path=/; Max-Age=31536000; SameSite=Lax');
    return new Response(response.body, { status: response.status, headers });
  }
  if (selfParam === '0') {
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', 'self_exclude=0; Path=/; Max-Age=0; SameSite=Lax');
    return new Response(response.body, { status: response.status, headers });
  }

  if (!skip && !selfExclude && env.db) {
    const cf = request.cf || {};
    const ip = request.headers.get('cf-connecting-ip') || '';
    const ipHash = ip ? await sha256Hex(env.IP_HASH_SALT + ip) : '';

    waitUntil(
      env.db.prepare(
        `INSERT INTO requests (ts, host, path, method, status, country, asn, colo, user_agent, referer, ray, bot_score, verified_bot, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        Math.floor(Date.now() / 1000),
        url.hostname,
        path,
        request.method,
        response.status,
        cf.country || null,
        cf.asn ? String(cf.asn) : null,
        cf.colo || null,
        request.headers.get('user-agent') || null,
        request.headers.get('referer') || null,
        request.headers.get('cf-ray') || null,
        cf.botManagement?.score ?? null,
        cf.botManagement?.verifiedBot ? 1 : 0,
        ipHash || null
      ).run()
    );
  }

  return response;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
