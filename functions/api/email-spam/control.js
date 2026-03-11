import { verifySession } from '../../_auth.js';

const ALLOWED = ['list_triggers', 'install_triggers', 'unmark_spam'];

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const caller = await env.db.prepare('SELECT is_admin FROM users WHERE id = ?')
    .bind(session.user_id).first();
  if (!caller?.is_admin) return json({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const { action, sender, subject } = body;
  if (!ALLOWED.includes(action)) return json({ error: 'unknown action' }, 400);

  const apiUrl   = env.SPAM_APPS_API_URL;
  const apiToken = env.SPAM_APPS_API_TOKEN;
  if (!apiUrl) return json({ error: 'not configured' }, 500);

  let params = '?action=' + action + '&token=' + encodeURIComponent(apiToken || '');
  if (action === 'unmark_spam') {
    if (sender)  params += '&sender='  + encodeURIComponent(sender);
    if (subject) params += '&subject=' + encodeURIComponent(subject);
  }

  let resp;
  try {
    resp = await fetch(apiUrl + params);
  } catch {
    return json({ error: 'apps script unreachable' }, 502);
  }

  const text = await resp.text();
  return new Response(text, {
    status: resp.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
