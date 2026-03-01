export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  // respect self-exclude
  const cookie = request.headers.get('cookie') || '';
  if (/(?:^|;\s*)self_exclude=1/.test(cookie)) {
    return new Response(null, { status: 200 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }

  if (!Array.isArray(body) || body.length === 0 || body.length > 50) {
    return new Response('bad request', { status: 400 });
  }

  const cf = request.cf || {};
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ipHash = ip ? await sha256Hex((env.IP_HASH_SALT || '') + ip) : '';
  const ua = request.headers.get('user-agent') || null;
  const referer = request.headers.get('referer') || null;
  const botScore = cf.botManagement?.score ?? null;
  const verifiedBot = cf.botManagement?.verifiedBot ? 1 : 0;
  const now = Math.floor(Date.now() / 1000);

  if (!env.db) return new Response(null, { status: 200 });

  const stmts = body.map(ev => {
    const data = ev.data != null ? JSON.stringify(ev.data) : null;
    return env.db.prepare(
      `INSERT INTO events (ts, vid, sid, type, path, data, user_agent, referer, bot_score, verified_bot, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      ev.ts || now,
      ev.vid || null,
      ev.sid || null,
      ev.type || null,
      ev.path || null,
      data,
      ua,
      referer,
      botScore,
      verifiedBot,
      ipHash || null
    );
  });

  waitUntil(env.db.batch(stmts));

  return new Response(null, { status: 200 });
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
