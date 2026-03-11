import { verifySession } from '../../_auth.js';

const ALLOWED = ['personal', 'spam'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  await ensureMigration(env);
  const account = await getAccount(env, session.user_id);
  return json({ account, available: ALLOWED });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }

  const { account } = body;
  if (!ALLOWED.includes(account)) return json({ error: 'invalid account' }, 400);

  await ensureMigration(env);
  await env.db.prepare('UPDATE users SET email_spam_account = ? WHERE id = ?')
    .bind(account, session.user_id).run();
  return json({ account });
}

async function ensureMigration(env) {
  try {
    await env.db.prepare(
      "ALTER TABLE users ADD COLUMN email_spam_account TEXT DEFAULT 'personal'"
    ).run();
  } catch {}
}

async function getAccount(env, userId) {
  try {
    const row = await env.db.prepare(
      'SELECT email_spam_account FROM users WHERE id = ?'
    ).bind(userId).first();
    return row?.email_spam_account || 'personal';
  } catch {
    return 'personal';
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
