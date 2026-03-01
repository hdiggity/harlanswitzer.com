import { verifySession } from '../_auth.js';

// ── tuning (edit these to adjust classification sensitivity) ──────────────────
const SESSION_GAP_S       = 1800; // seconds gap between requests → new session
const HUMAN_THRESHOLD     = 2;    // score >= this → HUMAN
const AUTO_THRESHOLD      = -2;   // score <= this → AUTOMATED
const BURST_WINDOW_S      = 10;   // burst detection: rolling time window (seconds)
const BURST_MIN_REQS      = 20;   // burst detection: requests within window → flag
const CRAWL_WINDOW_S      = 120;  // crawl detection: rolling time window (seconds)
const CRAWL_MIN_PATHS     = 15;   // crawl detection: distinct paths within window → flag
const ENGAGE_DURATION_S   = 15;   // engaged session: minimum duration in seconds
const ENGAGE_PV_MIN       = 2;    // engaged session: minimum pageviews
const INTERACTIVE_SLACK_S = 60;   // seconds slack when associating events to a session
const REQUEST_CAP         = 10000; // max rows pulled per window for scoring

const SCANNER_TOKENS = [
  'wp-login', 'xmlrpc', '.env', 'phpmyadmin', 'admin.php',
  'upload', 'fileupload', 'multipart', 'blob', '/s3', 'storage',
  'import', 'batch', 'drive', 'v1/upload', 'v2/upload',
];

const BOT_UA_TOKENS     = ['bot', 'spider', 'crawler', 'curl', 'wget', 'python', 'go-http', 'java/', 'okhttp', 'axios', 'scrapy'];
const BROWSER_UA_TOKENS = ['safari', 'chrome', 'firefox'];

// ── signal helpers ────────────────────────────────────────────────────────────

function isScannerPath(path) {
  if (!path) return false;
  const lp = path.toLowerCase();
  return SCANNER_TOKENS.some(t => lp.includes(t));
}

function isBotUA(ua) {
  if (!ua) return false;
  const lu = ua.toLowerCase();
  return BOT_UA_TOKENS.some(t => lu.includes(t));
}

function isBrowserUA(ua) {
  if (!ua) return false;
  const lu = ua.toLowerCase();
  return BROWSER_UA_TOKENS.some(t => lu.includes(t)) && !isBotUA(ua);
}

function isPageview(method, path) {
  return method === 'GET' && (path === '/' || (path && path.endsWith('.html')));
}

// O(n) sliding-window burst detection
function hasBurst(reqs) {
  let left = 0;
  for (let right = 0; right < reqs.length; right++) {
    while (reqs[right].ts - reqs[left].ts > BURST_WINDOW_S) left++;
    if (right - left + 1 >= BURST_MIN_REQS) return true;
  }
  return false;
}

// O(n) sliding-window path-diversity detection
function hasCrawl(reqs) {
  const counts = new Map();
  let unique = 0, left = 0;
  for (let right = 0; right < reqs.length; right++) {
    const p = reqs[right].path || '';
    const c = (counts.get(p) || 0) + 1;
    counts.set(p, c);
    if (c === 1) unique++;
    while (reqs[right].ts - reqs[left].ts > CRAWL_WINDOW_S) {
      const lp = reqs[left].path || '';
      const lc = counts.get(lp) - 1;
      counts.set(lp, lc);
      if (lc === 0) { counts.delete(lp); unique--; }
      left++;
    }
    if (unique >= CRAWL_MIN_PATHS) return true;
  }
  return false;
}

// Split one visitor's sorted requests into sessions
function sessionize(reqs) {
  const out = [];
  let cur = [reqs[0]];
  for (let i = 1; i < reqs.length; i++) {
    if (reqs[i].ts - reqs[i - 1].ts > SESSION_GAP_S) { out.push(cur); cur = []; }
    cur.push(reqs[i]);
  }
  out.push(cur);
  return out;
}

// Score a session. Returns a number; classify() turns it into a label.
// CF bot_score convention: 1=bot, 99=human. LOW score = automation signal.
function scoreSession(reqs, ua, interactiveTs, hasPerfEvent) {
  let score = 0;

  // — automation signals —
  if (reqs.some(r => r.verified_bot === 1)) score -= 5;

  let minBot = Infinity;
  for (const r of reqs) {
    if (r.bot_score !== null && r.bot_score !== undefined && r.bot_score < minBot) {
      minBot = r.bot_score;
    }
  }
  if (minBot !== Infinity) {
    if (minBot < 30) score -= 4;       // CF: definitely bot zone
    else if (minBot < 60) score -= 2;  // CF: borderline
  }

  if (reqs.some(r =>
    ['POST', 'PUT', 'PATCH'].includes(r.method) && [401, 403, 404, 405].includes(r.status)
  )) score -= 2;

  if (reqs.some(r => isScannerPath(r.path))) score -= 3;
  if (hasBurst(reqs)) score -= 3;
  if (hasCrawl(reqs)) score -= 2;

  // — human signals —
  const pvs = reqs.filter(r => isPageview(r.method, r.path));
  if (pvs.length > 0) score += 2;
  if (reqs.some(r => r.referer && r.referer.length > 0)) score += 1;
  if (isBrowserUA(ua)) score += 1;

  const duration = reqs[reqs.length - 1].ts - reqs[0].ts;
  if (duration >= ENGAGE_DURATION_S && pvs.length >= ENGAGE_PV_MIN) score += 2;

  if (interactiveTs !== undefined) {
    const start = reqs[0].ts;
    const end   = reqs[reqs.length - 1].ts;
    if (interactiveTs >= start - INTERACTIVE_SLACK_S && interactiveTs <= end + INTERACTIVE_SLACK_S) {
      score += 3;
    }
  }

  if (hasPerfEvent && pvs.length > 0) score += 1;

  return score;
}

function classify(score) {
  if (score >= HUMAN_THRESHOLD) return 'human';
  if (score <= AUTO_THRESHOLD)  return 'automated';
  return 'unknown';
}

// ── aggregation helpers ───────────────────────────────────────────────────────

function topN(map, n = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

function mostFrequent(arr) {
  const m = new Map();
  for (const v of arr) if (v) m.set(v, (m.get(v) || 0) + 1);
  let best = null, bestN = 0;
  for (const [v, n] of m) if (n > bestN) { best = v; bestN = n; }
  return best;
}

// ── main handler ──────────────────────────────────────────────────────────────

export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await verifySession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.db) {
    return new Response(JSON.stringify({ error: 'server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const caller = await env.db.prepare('SELECT is_admin FROM users WHERE id = ?').bind(session.user_id).first();
  if (!caller?.is_admin) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  const url   = new URL(request.url);
  const hours = Math.min(Math.max(parseInt(url.searchParams.get('hours') || '24', 10), 1), 720);
  const windowStart = Math.floor(Date.now() / 1000) - hours * 3600;

  const [rawReqs, botSummary, botCountries, botAgents, rawEvents, recentRaw, user] = await Promise.all([
    // non-verified-bot requests for JS scoring (verified bots pre-aggregated below)
    env.db.prepare(`
      SELECT ts, ip_hash, user_agent, path, method, status, bot_score, verified_bot, referer, country
      FROM requests
      WHERE ts > ?
        AND verified_bot = 0
      ORDER BY ts ASC
      LIMIT ?
    `).bind(windowStart, REQUEST_CAP).all(),

    // verified bots: always AUTOMATED — aggregate in SQL, skip JS scoring
    env.db.prepare(`
      WITH s AS (
        SELECT
          ip_hash || '|' || user_agent AS vk,
          ts, method, path,
          LAG(ts) OVER (PARTITION BY ip_hash, user_agent ORDER BY ts) AS prev_ts
        FROM requests
        WHERE ts > ? AND verified_bot = 1
      )
      SELECT
        COUNT(DISTINCT vk) AS visitors,
        SUM(CASE WHEN prev_ts IS NULL OR ts - prev_ts > 1800 THEN 1 ELSE 0 END) AS sessions,
        SUM(CASE WHEN method = 'GET' AND (path = '/' OR path LIKE '%.html') THEN 1 ELSE 0 END) AS pageviews,
        COUNT(*) AS requests
      FROM s
    `).bind(windowStart).first(),

    // verified bot top countries (counted by session start, not raw requests)
    env.db.prepare(`
      WITH s AS (
        SELECT country, ts, ip_hash, user_agent,
          LAG(ts) OVER (PARTITION BY ip_hash, user_agent ORDER BY ts) AS prev_ts
        FROM requests
        WHERE ts > ? AND verified_bot = 1 AND country IS NOT NULL
      )
      SELECT country, COUNT(*) AS count
      FROM s
      WHERE prev_ts IS NULL OR ts - prev_ts > 1800
      GROUP BY country
      ORDER BY count DESC
      LIMIT 20
    `).bind(windowStart).all(),

    // verified bot top agents
    env.db.prepare(`
      SELECT user_agent, COUNT(DISTINCT ip_hash || '|' || user_agent) AS count
      FROM requests
      WHERE ts > ? AND verified_bot = 1 AND user_agent IS NOT NULL
      GROUP BY user_agent
      ORDER BY count DESC
      LIMIT 10
    `).bind(windowStart).all(),

    // events in window for interactive/performance signals
    env.db.prepare(`
      SELECT ts, ip_hash, user_agent, type
      FROM events
      WHERE ts > ?
        AND type IN ('click', 'scroll', 'performance', 'navigation', 'pageview')
      ORDER BY ts ASC
    `).bind(windowStart).all(),

    // raw request log for the requests tab (most recent first)
    env.db.prepare(`
      SELECT ts, method, path, status, country, bot_score, verified_bot, referer
      FROM requests
      WHERE ts > ?
      ORDER BY ts DESC
      LIMIT 200
    `).bind(windowStart).all(),

    env.db.prepare('SELECT username FROM users WHERE id = ?').bind(session.user_id).first(),
  ]);

  const reqs   = rawReqs.results  || [];
  const events = rawEvents.results || [];
  const recent = recentRaw.results || [];

  // Per-visitor event signals
  const interactiveTs = new Map(); // visitor_key → earliest interactive event ts
  const perfVisitors  = new Set(); // visitor_keys with performance/navigation events
  for (const e of events) {
    const key = (e.ip_hash || '') + '|' + (e.user_agent || '');
    if (e.type === 'click' || e.type === 'scroll') {
      const cur = interactiveTs.get(key);
      if (cur === undefined || e.ts < cur) interactiveTs.set(key, e.ts);
    }
    if (e.type === 'performance' || e.type === 'navigation') perfVisitors.add(key);
  }

  // Group requests by visitor_key
  const byVisitor = new Map();
  for (const r of reqs) {
    const key = (r.ip_hash || '') + '|' + (r.user_agent || '');
    if (!byVisitor.has(key)) byVisitor.set(key, []);
    byVisitor.get(key).push(r);
  }

  // Accumulators
  const summary = {
    human:     { visitors: 0, sessions: 0, pageviews: 0, requests: 0 },
    automated: { visitors: 0, sessions: 0, pageviews: 0, requests: 0 },
    unknown:   { visitors: 0, sessions: 0, pageviews: 0, requests: 0 },
  };
  const countriesHuman  = new Map();
  const countriesAuto   = new Map();
  const suspiciousPaths = new Map();
  const autoAgents      = new Map();
  const humanReferrers  = new Map();
  const sessionRows     = [];

  for (const [visitorKey, visitorReqs] of byVisitor) {
    visitorReqs.sort((a, b) => a.ts - b.ts);
    const ua     = visitorReqs[0]?.user_agent || '';
    const intTs  = interactiveTs.get(visitorKey);
    const hasPef = perfVisitors.has(visitorKey);

    const sessions = sessionize(visitorReqs);
    const scored   = sessions.map(sreqs => {
      const score = scoreSession(sreqs, ua, intTs, hasPef);
      return { sreqs, score, cls: classify(score) };
    });

    // Visitor classification = best class across all their sessions
    let visitorClass = 'automated';
    if (scored.some(s => s.cls === 'human'))    visitorClass = 'human';
    else if (scored.some(s => s.cls === 'unknown')) visitorClass = 'unknown';
    summary[visitorClass].visitors++;

    for (const { sreqs, score, cls } of scored) {
      const pvCount  = sreqs.filter(r => isPageview(r.method, r.path)).length;
      const country  = mostFrequent(sreqs.map(r => r.country));
      const duration = sreqs[sreqs.length - 1].ts - sreqs[0].ts;

      summary[cls].sessions++;
      summary[cls].pageviews += pvCount;
      summary[cls].requests  += sreqs.length;

      if (cls === 'human') {
        if (country) countriesHuman.set(country, (countriesHuman.get(country) || 0) + 1);
        for (const r of sreqs) {
          if (r.referer) humanReferrers.set(r.referer, (humanReferrers.get(r.referer) || 0) + 1);
        }
      }

      if (cls === 'automated') {
        if (country) countriesAuto.set(country, (countriesAuto.get(country) || 0) + 1);
        for (const r of sreqs) {
          if (isScannerPath(r.path)) suspiciousPaths.set(r.path, (suspiciousPaths.get(r.path) || 0) + 1);
        }
        if (ua) autoAgents.set(ua, (autoAgents.get(ua) || 0) + 1);
      }

      if (sessionRows.length < 300) {
        sessionRows.push({
          ts:         sreqs[0].ts,
          cls,
          score,
          country:    country || null,
          requests:   sreqs.length,
          pageviews:  pvCount,
          duration,
          first_path: sreqs[0].path || '',
          ua:         ua.slice(0, 80),
        });
      }
    }
  }

  // Merge pre-aggregated verified-bot totals into automated bucket
  const bs = botSummary || {};
  summary.automated.visitors  += bs.visitors  || 0;
  summary.automated.sessions  += bs.sessions  || 0;
  summary.automated.pageviews += bs.pageviews || 0;
  summary.automated.requests  += bs.requests  || 0;
  for (const { country, count } of (botCountries.results || [])) {
    if (country) countriesAuto.set(country, (countriesAuto.get(country) || 0) + count);
  }
  for (const { user_agent, count } of (botAgents.results || [])) {
    if (user_agent) autoAgents.set(user_agent, (autoAgents.get(user_agent) || 0) + count);
  }

  sessionRows.sort((a, b) => b.ts - a.ts);

  return new Response(JSON.stringify({
    username:                user?.username || null,
    window_hours:            hours,
    truncated:               reqs.length === REQUEST_CAP,
    summary,
    top_countries_human:     topN(countriesHuman).map(({ key: country, count }) => ({ country, count })),
    top_countries_automated: topN(countriesAuto).map(({ key: country, count }) => ({ country, count })),
    top_suspicious_paths:    topN(suspiciousPaths).map(({ key: path, count }) => ({ path, count })),
    top_automated_agents:    topN(autoAgents, 10).map(({ key: agent, count }) => ({ agent, count })),
    top_referrers_human:     topN(humanReferrers).map(({ key: referer, count }) => ({ referer, count })),
    recent_sessions:         sessionRows,
    recent_requests:         recent,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
