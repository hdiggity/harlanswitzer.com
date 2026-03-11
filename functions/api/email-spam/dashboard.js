import { verifySession } from '../../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const apiUrl   = env.SPAM_APPS_API_URL;
  const apiToken = env.SPAM_APPS_API_TOKEN;
  if (!apiUrl) return json({ error: 'not configured' }, 500);

  const reqUrl  = new URL(request.url);
  const details = reqUrl.searchParams.get('details') === 'full' ? 'full' : 'masked';

  const fetchUrl = apiUrl + '?action=get_dashboard&token=' + encodeURIComponent(apiToken || '');
  let resp;
  try {
    resp = await fetch(fetchUrl);
  } catch {
    return json({ error: 'apps script unreachable' }, 502);
  }

  let parsed;
  try {
    parsed = await resp.json();
  } catch {
    return json({ error: 'invalid response from apps script' }, 502);
  }

  if (!resp.ok || !parsed.success) {
    return json({ error: parsed.error || 'apps script error' }, 502);
  }

  if (details === 'masked') {
    const rows = parsed.data?.recentRows || [];
    parsed.data.recentRows = rows.map(row => {
      const m = Object.assign({}, row);
      if (m['sender'])       m['sender']       = maskSender(m['sender']);
      if (m['subject'])      m['subject']      = '[hidden]';
      if (m['body summary']) m['body summary'] = '[hidden]';
      return m;
    });
  }

  parsed.details = details;
  return json(parsed);
}

function maskSender(sender) {
  const s = String(sender);
  const at = s.indexOf('@');
  return at > 0 ? '***' + s.slice(at) : '***';
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
