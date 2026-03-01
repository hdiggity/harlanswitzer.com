import { verifySession } from '../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);
  if (!env.db)  return json({ error: 'server error' }, 500);

  const method = request.method.toUpperCase();

  if (method === 'GET') return handleGet(env);
  if (method === 'PATCH') return handlePatch(request, env, session);
  if (method === 'DELETE') return handleDelete(request, env, session);

  return json({ error: 'method not allowed' }, 405);
}

async function handleGet(env) {
  const [users, activeSessions] = await Promise.all([
    env.db.prepare(`
      SELECT id, username, created_at FROM users ORDER BY created_at ASC
    `).all(),
    env.db.prepare(`
      SELECT user_id, COUNT(*) AS count
      FROM sessions
      WHERE revoked = 0 AND expires_at > ?
      GROUP BY user_id
    `).bind(Math.floor(Date.now() / 1000)).all(),
  ]);

  const sessionMap = new Map();
  for (const s of (activeSessions.results || [])) {
    sessionMap.set(s.user_id, s.count);
  }

  const list = (users.results || []).map(u => ({
    id:              u.id,
    username:        u.username,
    created_at:      u.created_at,
    active_sessions: sessionMap.get(u.id) || 0,
  }));

  return json({ users: list }, 200);
}

async function handlePatch(request, env, session) {
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
  const passwordHash = await pbkdf2Hex(password, salt, iterations);

  await env.db.prepare(
    'UPDATE users SET password_hash = ?, salt = ?, iterations = ? WHERE id = ?'
  ).bind(passwordHash, salt, iterations, user_id).run();

  // revoke all existing sessions for that user so the new password takes effect
  await env.db.prepare(
    'UPDATE sessions SET revoked = 1 WHERE user_id = ?'
  ).bind(user_id).run();

  return json({ ok: true }, 200);
}

async function handleDelete(request, env, session) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const { user_id } = body || {};
  if (!user_id) return json({ error: 'user_id required' }, 400);

  // prevent deleting yourself
  if (user_id === session.user_id) return json({ error: 'cannot delete your own account' }, 400);

  const target = await env.db.prepare('SELECT id FROM users WHERE id = ?').bind(user_id).first();
  if (!target) return json({ error: 'user not found' }, 404);

  await env.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user_id).run();
  await env.db.prepare('DELETE FROM users WHERE id = ?').bind(user_id).run();

  return json({ ok: true }, 200);
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
