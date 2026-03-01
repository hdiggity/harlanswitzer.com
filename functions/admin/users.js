import { verifySession } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  if (!env.db)  return json({ error: 'server error' }, 500);

  const method = request.method.toUpperCase();

  if (method === 'GET')    return handleGet(env);
  if (method === 'POST')   return handlePost(request, env, session);
  if (method === 'PATCH')  return handlePatch(request, env);
  if (method === 'DELETE') return handleDelete(request, env, session);

  return json({ error: 'method not allowed' }, 405);
}

async function handleGet(env) {
  const now = Math.floor(Date.now() / 1000);
  const [users, sessions] = await Promise.all([
    env.db.prepare('SELECT id, username, created_at FROM users ORDER BY created_at ASC').all(),
    env.db.prepare(`
      SELECT id, user_id, created_at, expires_at
      FROM sessions
      WHERE revoked = 0 AND expires_at > ?
      ORDER BY created_at DESC
    `).bind(now).all(),
  ]);

  const sessMap = new Map();
  for (const s of (sessions.results || [])) {
    if (!sessMap.has(s.user_id)) sessMap.set(s.user_id, []);
    sessMap.get(s.user_id).push({ id: s.id, created_at: s.created_at, expires_at: s.expires_at });
  }

  const list = (users.results || []).map(u => ({
    id:         u.id,
    username:   u.username,
    created_at: u.created_at,
    sessions:   sessMap.get(u.id) || [],
  }));

  return json({ users: list });
}

async function handlePost(request, env, callerSession) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { action } = body || {};

  if (action === 'create_user') {
    const { username, password } = body;
    if (!username || !password) return json({ error: 'username and password required' }, 400);
    if (typeof password !== 'string' || password.length < 12) {
      return json({ error: 'password must be at least 12 characters' }, 400);
    }
    const existing = await env.db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) return json({ error: 'username already taken' }, 409);

    const salt = crypto.randomUUID();
    const iterations = 100000;
    const hash = await pbkdf2Hex(password, salt, iterations);
    const now = Math.floor(Date.now() / 1000);
    await env.db.prepare(
      'INSERT INTO users (username, password_hash, salt, iterations, created_at) VALUES (?,?,?,?,?)'
    ).bind(username, hash, salt, iterations, now).run();
    return json({ ok: true });
  }

  if (action === 'revoke_session') {
    const { session_id } = body;
    if (!session_id) return json({ error: 'session_id required' }, 400);
    await env.db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').bind(session_id).run();
    return json({ ok: true });
  }

  if (action === 'revoke_all') {
    const { user_id } = body;
    if (!user_id) return json({ error: 'user_id required' }, 400);
    await env.db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').bind(user_id).run();
    return json({ ok: true });
  }

  return json({ error: 'unknown action' }, 400);
}

async function handlePatch(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const { user_id, password } = body || {};
  if (!user_id || !password) return json({ error: 'user_id and password required' }, 400);
  if (typeof password !== 'string' || password.length < 12) {
    return json({ error: 'password must be at least 12 characters' }, 400);
  }

  const target = await env.db.prepare('SELECT id FROM users WHERE id = ?').bind(user_id).first();
  if (!target) return json({ error: 'user not found' }, 404);

  const salt = crypto.randomUUID();
  const iterations = 100000;
  const hash = await pbkdf2Hex(password, salt, iterations);

  await env.db.prepare(
    'UPDATE users SET password_hash = ?, salt = ?, iterations = ? WHERE id = ?'
  ).bind(hash, salt, iterations, user_id).run();

  await env.db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').bind(user_id).run();

  return json({ ok: true });
}

async function handleDelete(request, env, callerSession) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const { user_id } = body || {};
  if (!user_id) return json({ error: 'user_id required' }, 400);
  if (user_id === callerSession.user_id) return json({ error: 'cannot delete your own account' }, 400);

  const target = await env.db.prepare('SELECT id FROM users WHERE id = ?').bind(user_id).first();
  if (!target) return json({ error: 'user not found' }, 404);

  await env.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user_id).run();
  await env.db.prepare('DELETE FROM users WHERE id = ?').bind(user_id).run();

  return json({ ok: true });
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
