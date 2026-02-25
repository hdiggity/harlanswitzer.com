export async function onRequestPost(context) {
  const { request, env } = context;

  const token = request.headers.get('x-setup-token');
  if (!token || token !== env.ADMIN_SETUP_TOKEN) {
    return json({ error: 'forbidden' }, 403);
  }

  if (!env.db) return json({ error: 'server error' }, 500);

  const existing = await env.db.prepare('SELECT id FROM users LIMIT 1').first();
  if (existing) {
    return json({ error: 'already registered' }, 409);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const { username, password } = body || {};
  if (!username || typeof username !== 'string' || username.length < 1) {
    return json({ error: 'invalid username' }, 400);
  }
  if (!password || typeof password !== 'string' || password.length < 12) {
    return json({ error: 'password must be at least 12 characters' }, 400);
  }

  const salt = crypto.randomUUID();
  const iterations = 100000;
  const passwordHash = await pbkdf2Hex(password, salt, iterations);
  const now = Math.floor(Date.now() / 1000);

  await env.db.prepare(
    'INSERT INTO users (username, password_hash, salt, iterations, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(username, passwordHash, salt, iterations, now).run();

  return json({ ok: true }, 201);
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
