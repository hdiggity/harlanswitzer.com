import { verifySession } from '../_auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (session && env.DB) {
    await env.DB.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').bind(session.id).run();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax',
    },
  });
}
