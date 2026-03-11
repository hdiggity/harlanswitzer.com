import { verifySession } from '../../_auth.js';

const ALLOWED_ACTIONS  = ['list_triggers', 'install_triggers', 'unmark_spam'];
const ALLOWED_ACCOUNTS = ['personal', 'spam'];

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const caller = await env.db.prepare('SELECT is_admin FROM users WHERE id = ?')
    .bind(session.user_id).first();
  if (!caller?.is_admin) return json({ error: 'forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }

  const { action, sender, subject, account: accountOverride } = body;
  if (!ALLOWED_ACTIONS.includes(action)) return json({ error: 'unknown action' }, 400);

  const { url, token } = await resolveBackend(env, session.user_id, accountOverride);
  if (!url) return json({ error: 'not configured for this account' }, 500);

  let params = '?action=' + action + '&token=' + encodeURIComponent(token || '');
  if (action === 'unmark_spam') {
    if (sender)  params += '&sender='  + encodeURIComponent(sender);
    if (subject) params += '&subject=' + encodeURIComponent(subject);
  }

  let resp;
  try { resp = await fetch(url + params); } catch { return json({ error: 'apps script unreachable' }, 502); }

  const text = await resp.text();
  return new Response(text, {
    status: resp.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resolveBackend(env, userId, override) {
  let account = override && ALLOWED_ACCOUNTS.includes(override) ? override : null;
  if (!account) {
    try {
      const row = await env.db.prepare(
        'SELECT email_spam_account FROM users WHERE id = ?'
      ).bind(userId).first();
      account = row?.email_spam_account || 'personal';
    } catch { account = 'personal'; }
  }
  const s = account === 'spam' ? '_SPAM' : '_PERSONAL';
  return { account, url: env['EMAIL_SPAM_APPS_URL' + s], token: env['EMAIL_SPAM_APPS_TOKEN' + s] };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
