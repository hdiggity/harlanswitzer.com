import { verifySession } from '../../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const apiUrl   = env.SPAM_APPS_API_URL;
  const apiToken = env.SPAM_APPS_API_TOKEN;
  if (!apiUrl) return json({ error: 'not configured' }, 500);

  const fetchUrl = apiUrl + '?action=get_dashboard&token=' + encodeURIComponent(apiToken || '');
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
