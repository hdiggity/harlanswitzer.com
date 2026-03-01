import { verifySession } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await verifySession(request, env);
  if (!session) {
    return new Response(
      JSON.stringify({ loggedIn: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (env.db) {
    // Runtime migration: add is_admin column if missing
    try {
      await env.db.prepare('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0').run();
    } catch { /* already exists */ }
    // Bootstrap: if no admin users exist yet, promote all current users
    await env.db.prepare(
      'UPDATE users SET is_admin = 1 WHERE (SELECT COUNT(*) FROM users WHERE is_admin = 1) = 0'
    ).run().catch(() => {});
  }

  const user = env.db
    ? await env.db.prepare('SELECT username, is_admin FROM users WHERE id = ?').bind(session.user_id).first()
    : null;

  return new Response(
    JSON.stringify({
      loggedIn:   true,
      user_id:    session.user_id,
      session_id: session.id,
      username:   user?.username  ?? null,
      is_admin:   user?.is_admin  ?? 0,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
