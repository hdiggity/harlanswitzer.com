import { verifySession } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const [
    recentRequests,
    recentEvents,
    topPaths,
    topCountries,
    topReferers,
    botSplit,
  ] = await Promise.all([
    env.DB.prepare(
      'SELECT ts, method, path, status, country, bot_score FROM requests ORDER BY ts DESC LIMIT 100'
    ).all(),
    env.DB.prepare(
      'SELECT ts, type, path, vid FROM events ORDER BY ts DESC LIMIT 100'
    ).all(),
    env.DB.prepare(
      'SELECT path, COUNT(*) AS count FROM requests GROUP BY path ORDER BY count DESC LIMIT 20'
    ).all(),
    env.DB.prepare(
      'SELECT country, COUNT(*) AS count FROM requests WHERE country IS NOT NULL GROUP BY country ORDER BY count DESC LIMIT 20'
    ).all(),
    env.DB.prepare(
      'SELECT referer, COUNT(*) AS count FROM requests WHERE referer IS NOT NULL GROUP BY referer ORDER BY count DESC LIMIT 20'
    ).all(),
    env.DB.prepare(
      'SELECT verified_bot, COUNT(*) AS count FROM requests GROUP BY verified_bot'
    ).all(),
  ]);

  return new Response(JSON.stringify({
    recentRequests: recentRequests.results,
    recentEvents: recentEvents.results,
    topPaths: topPaths.results,
    topCountries: topCountries.results,
    topReferers: topReferers.results,
    botSplit: botSplit.results,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
