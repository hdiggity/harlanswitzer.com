// Rate limits
const IP_MAX    = 5;           // failed attempts per IP
const IP_WIN    = 10 * 60;     // within 10 minutes
const UN_MAX    = 10;          // failed attempts per username
const UN_WIN    = 30 * 60;     // within 30 minutes

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SESSION_SIGNING_KEY) return json({ error: 'SESSION_SIGNING_KEY not set' }, 500);
  if (!env.db) return json({ error: 'DB binding not set' }, 500);

  const now    = Math.floor(Date.now() / 1000);
  const ip     = request.headers.get('cf-connecting-ip') || '';
  const ipHash = ip ? await sha256Hex((env.IP_HASH_SALT || '') + ip) : 'unknown';

  // ── IP rate check ─────────────────────────────────────────────────────────
  try {
    const r = await env.db.prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND ts > ?'
    ).bind(ipHash, now - IP_WIN).first();
    if ((r?.n ?? 0) >= IP_MAX) return json({ error: 'too many attempts — try again later' }, 429);
  } catch { /* table may not exist yet */ }

  // ── parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const { username, password } = body || {};
  if (!username || !password) return json({ error: 'missing credentials' }, 400);

  // ── per-username rate check ───────────────────────────────────────────────
  // stored as 'u:<hash>' so it never collides with IP entries
  const unKey = 'u:' + await sha256Hex((env.IP_HASH_SALT || '') + ':un:' + username.toLowerCase());
  try {
    const r = await env.db.prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE ip_hash = ? AND ts > ?'
    ).bind(unKey, now - UN_WIN).first();
    if ((r?.n ?? 0) >= UN_MAX) return json({ error: 'too many attempts — try again later' }, 429);
  } catch { /* skip */ }

  // ── look up user ──────────────────────────────────────────────────────────
  let user;
  try {
    user = await env.db.prepare(
      'SELECT id, password_hash, salt, iterations FROM users WHERE username = ?'
    ).bind(username).first();
  } catch (e) {
    return json({ error: 'db error: ' + e.message }, 500);
  }

  // record a failure (both IP and username keys) — called on any auth failure
  const recordFail = () => Promise.all([
    env.db.prepare('INSERT INTO login_attempts (ip_hash, ts) VALUES (?,?)').bind(ipHash, now).run(),
    env.db.prepare('INSERT INTO login_attempts (ip_hash, ts) VALUES (?,?)').bind(unKey,  now).run(),
  ]).catch(() => {});

  if (!user) {
    // dummy hash to equalise timing regardless of whether user exists
    await pbkdf2Hex(password, 'dummy-salt', 100000);
    await recordFail();
    return json({ error: 'invalid credentials' }, 401);
  }

  const hash = await pbkdf2Hex(password, user.salt, user.iterations);
  if (!(await timingSafeEqual(hash, user.password_hash))) {
    await recordFail();
    return json({ error: 'invalid credentials' }, 401);
  }

  // ── success — create session ───────────────────────────────────────────────
  const sessionId = crypto.randomUUID();
  const expiresAt = now + 7 * 24 * 60 * 60;

  try {
    await env.db.prepare(
      'INSERT INTO sessions (id, user_id, expires_at, revoked, created_at) VALUES (?,?,?,0,?)'
    ).bind(sessionId, user.id, expiresAt, now).run();
  } catch (e) {
    return json({ error: 'db error: ' + e.message }, 500);
  }

  // prune old login_attempts rows (> 1 hour) to keep the table lean
  env.waitUntil?.(
    env.db.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(now - 3600).run().catch(() => {})
  );

  const sig       = await hmacHex(sessionId, env.SESSION_SIGNING_KEY);
  const cookieVal = `${sessionId}.${sig}`;

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${cookieVal}; HttpOnly; Secure; Path=/; Max-Age=604800; SameSite=Lax`,
    },
  });
}

// ── crypto helpers ────────────────────────────────────────────────────────────

async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [sa, sb] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ]);
  const va = new Uint8Array(sa), vb = new Uint8Array(sb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2Hex(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(data, key) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
