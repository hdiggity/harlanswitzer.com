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

  const user = env.db
    ? await env.db.prepare('SELECT username FROM users WHERE id = ?').bind(session.user_id).first()
    : null;

  return new Response(
    JSON.stringify({ loggedIn: true, user_id: session.user_id, username: user?.username || null }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
