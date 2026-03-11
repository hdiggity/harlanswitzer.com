import { verifySession } from '../../_auth.js';

const ALLOWED = ['personal', 'spam'];

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const reqUrl   = new URL(request.url);
  const override = reqUrl.searchParams.get('account') || null;
  const { url, token } = await resolveBackend(env, session.user_id, override);
  if (!url) return json({ error: 'not configured for this account' }, 500);

  const fetchUrl = url + '?action=get_dashboard&token=' + encodeURIComponent(token || '');
  let resp;
  try {
    resp = await fetch(fetchUrl);
  } catch {
    return json({ error: 'apps script unreachable' }, 502);
  }

  const body = await resp.text();
  return new Response(body, {
    status: resp.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resolveBackend(env, userId, override) {
  let account = override && ALLOWED.includes(override) ? override : null;
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
