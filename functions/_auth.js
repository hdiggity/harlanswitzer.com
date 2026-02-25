// shared session verification — not a route
export async function verifySession(request, env) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) return null;

  const raw = match[1];
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;

  const sessionId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  // recompute HMAC-SHA256(sessionId, SESSION_SIGNING_KEY)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  const sigBytes = hexToBytes(sig);
  if (!sigBytes) return null;

  const sessionIdBytes = new TextEncoder().encode(sessionId);
  const valid = await crypto.subtle.verify('HMAC', keyMaterial, sigBytes, sessionIdBytes);
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT id, user_id, expires_at FROM sessions WHERE id = ? AND revoked = 0'
  ).bind(sessionId).first();

  if (!row) return null;
  if (row.expires_at <= now) return null;

  return row;
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const val = parseInt(hex.slice(i, i + 2), 16);
    if (isNaN(val)) return null;
    bytes[i / 2] = val;
  }
  return bytes;
}
