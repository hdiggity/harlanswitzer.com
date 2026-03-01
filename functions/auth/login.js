export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SESSION_SIGNING_KEY) return json({ error: 'SESSION_SIGNING_KEY not set' }, 500);
  if (!env.db) return json({ error: 'DB binding not set' }, 500);

  // rate limit: 10 attempts per IP per 15 minutes
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ipHash = ip ? await sha256Hex((env.IP_HASH_SALT || '') + ip) : 'unknown';
  const window = Math.floor(Date.now() / 1000) - 15 * 60;

  let attempts = null;
  try {
    attempts = await env.db.prepare(
      'SELECT COUNT(*) AS count FROM login_attempts WHERE ip_hash = ? AND ts > ?'
    ).bind(ipHash, window).first();
  } catch (_) { /* table not yet created — skip rate check */ }

  if (attempts && attempts.count >= 10) {
    return json({ error: 'too many attempts — try again later' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const { username, password } = body || {};
  if (!username || !password) return json({ error: 'missing credentials' }, 400);

  let user;
  try {
    user = await env.db.prepare(
      'SELECT id, password_hash, salt, iterations FROM users WHERE username = ?'
    ).bind(username).first();
  } catch (e) {
    return json({ error: 'db error: ' + e.message }, 500);
  }

  const recordAttempt = () => env.db.prepare(
    'INSERT INTO login_attempts (ip_hash, ts) VALUES (?, ?)'
  ).bind(ipHash, Math.floor(Date.now() / 1000)).run().catch(() => {});

  if (!user) {
    await pbkdf2Hex(password, 'dummy-salt', 100000);
    await recordAttempt();
    return json({ error: 'invalid credentials' }, 401);
  }

  const hash = await pbkdf2Hex(password, user.salt, user.iterations);
  if (!(await timingSafeEqual(hash, user.password_hash))) {
    await recordAttempt();
    return json({ error: 'invalid credentials' }, 401);
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.db.prepare(
      'INSERT INTO sessions (id, user_id, expires_at, revoked, created_at) VALUES (?, ?, ?, 0, ?)'
    ).bind(sessionId, user.id, expiresAt, now).run();
  } catch (e) {
    return json({ error: 'db error: ' + e.message }, 500);
  }

  const sig = await hmacHex(sessionId, env.SESSION_SIGNING_KEY);
  const cookieVal = `${sessionId}.${sig}`;

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${cookieVal}; HttpOnly; Secure; Path=/; Max-Age=604800; SameSite=Lax`,
    },
  });
}

// constant-time string comparison via HMAC with a per-call random key
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
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(data, key) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
