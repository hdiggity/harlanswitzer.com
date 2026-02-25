export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SESSION_SIGNING_KEY) {
  return json({ error: 'missing signing key' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const { username, password } = body || {};
  if (!username || !password) {
    return json({ error: 'missing credentials' }, 400);
  }

  if (!env.DB) return json({ error: 'server error' }, 500);

  const user = await env.DB.prepare(
    'SELECT id, password_hash, salt, iterations FROM users WHERE username = ?'
  ).bind(username).first();

  if (!user) {
    // timing-safe: still do a hash to prevent user enumeration via timing
    await pbkdf2Hex(password, 'dummy-salt', 100000);
    return json({ error: 'invalid credentials' }, 401);
  }

  const hash = await pbkdf2Hex(password, user.salt, user.iterations);
  if (hash !== user.password_hash) {
    return json({ error: 'invalid credentials' }, 401);
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, revoked, created_at) VALUES (?, ?, ?, 0, ?)'
  ).bind(sessionId, user.id, expiresAt, now).run();

  const sig = await hmacHex(sessionId, env.SESSION_SIGNING_KEY);
  const cookieVal = `${sessionId}.${sig}`;

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${cookieVal}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`,
    },
  });
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
