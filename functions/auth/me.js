import { verifySession } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await verifySession(request, env);
  return new Response(
    JSON.stringify({ loggedIn: session !== null }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
