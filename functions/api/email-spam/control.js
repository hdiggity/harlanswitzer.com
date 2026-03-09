import { verifySession } from '../../_auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const action = body.action;
  if (!['list_triggers', 'install_triggers'].includes(action)) {
    return json({ error: 'unknown action' }, 400);
  }

  const apiUrl   = env.SPAM_APPS_API_URL;
  const apiToken = env.SPAM_APPS_API_TOKEN;
  if (!apiUrl) return json({ error: 'not configured' }, 500);

  const url = apiUrl + '?action=' + action + '&token=' + encodeURIComponent(apiToken || '');
  let resp;
  try {
    resp = await fetch(url);
  } catch (err) {
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
