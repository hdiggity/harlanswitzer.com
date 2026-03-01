import { verifySession } from '../_auth.js';

// ── crypto helpers ────────────────────────────────────────────────────────────

async function hmacHex(data, key) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeStrEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2Hex(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function timingSafeHashEqual(a, b) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [sa, sb] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ]);
  const va = new Uint8Array(sa), vb = new Uint8Array(sb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// ── bests access token (8-hour, per-session) ──────────────────────────────────

const TOKEN_TTL = 8 * 3600;
const TOKEN_SCOPE = ':bests-access-v1';

async function mintBestsToken(userId, env) {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const payload = userId + ':' + expires;
  const sig = await hmacHex(payload, env.SESSION_SIGNING_KEY + TOKEN_SCOPE);
  return payload + ':' + sig;
}

async function verifyBestsToken(header, userId, env) {
  if (!header) return false;
  const parts = header.split(':');
  if (parts.length !== 3) return false;
  const [tokenUserId, expires, sig] = parts;
  if (parseInt(tokenUserId, 10) !== userId) return false;
  if (parseInt(expires, 10) <= Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(tokenUserId + ':' + expires, env.SESSION_SIGNING_KEY + TOKEN_SCOPE);
  return timingSafeStrEqual(expected, sig);
}

// ── date helpers ─────────────────────────────────────────────────────────────

// Parses "M/YY", "MM/YY", "M/YYYY", "MM/YYYY" → Unix timestamp for first of that month UTC
function parseWhenTs(text) {
  if (!text) return null;
  const m = String(text).trim().match(/^(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12) return null;
  return Math.floor(Date.UTC(year, month - 1, 1) / 1000);
}

async function ensureWhenTsColumn(env) {
  try {
    await env.db.prepare('ALTER TABLE bests_beers ADD COLUMN when_ts INTEGER').run();
  } catch { /* already exists */ }
}

async function ensureHistoryTable(env) {
  try {
    await env.db.prepare(`
      CREATE TABLE IF NOT EXISTS bests_beer_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        beer_id    INTEGER NOT NULL,
        action     TEXT NOT NULL,
        snapshot   TEXT NOT NULL,
        changed_by INTEGER NOT NULL,
        changed_at INTEGER NOT NULL
      )
    `).run();
    await env.db.prepare(
      'CREATE INDEX IF NOT EXISTS bests_beer_history_beer ON bests_beer_history (beer_id, changed_at)'
    ).run();
  } catch { /* ok */ }
}

async function logHistory(env, beerId, action, snapshot, userId) {
  try {
    await env.db.prepare(
      'INSERT INTO bests_beer_history (beer_id, action, snapshot, changed_by, changed_at) VALUES (?,?,?,?,?)'
    ).bind(beerId, action, JSON.stringify(snapshot), userId, Math.floor(Date.now() / 1000)).run();
  } catch { /* non-fatal */ }
}

async function migrateWhenTs(env) {
  const rows = await env.db.prepare(
    'SELECT id, when_text FROM bests_beers WHERE when_text IS NOT NULL AND when_ts IS NULL'
  ).all();
  const now = Math.floor(Date.now() / 1000);
  for (const b of (rows.results || [])) {
    const ts = parseWhenTs(b.when_text);
    if (ts !== null) {
      await env.db.prepare('UPDATE bests_beers SET when_ts = ?, updated_at = ? WHERE id = ?')
        .bind(ts, now, b.id).run();
    }
  }
}

// Syncs country_territory and when_ts from sheet for existing beers that are missing them.
// Only called when all beers have null country (i.e. first load after seed with bad column match).
async function syncCountriesFromSheet(env) {
  const sheetId = env.BESTS_SHEET_ID;
  if (!sheetId) return;

  let csvText;
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`);
    if (!res.ok) return;
    csvText = await res.text();
  } catch { return; }

  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return;

  const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase().trim());
  const col = name => headers.indexOf(name);
  const colFirst = (...names) => names.reduce((f, n) => f >= 0 ? f : col(n), -1);

  const iBrewery = colFirst('brewery');
  const iProduct = colFirst('product');
  const iCountry = colFirst('country/territory', 'country / territory', 'country', 'origin', 'beer country');
  const iWhen    = colFirst('when', 'date', 'when_text');

  if (iBrewery < 0 || iProduct < 0) return;

  const now = Math.floor(Date.now() / 1000);
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    const brewery = (cols[iBrewery] || '').trim();
    const product = (cols[iProduct] || '').trim();
    if (!brewery || !product) continue;

    const country  = iCountry >= 0 ? (cols[iCountry] || '').trim() || null : null;
    const whenText = iWhen >= 0    ? (cols[iWhen]    || '').trim() || null : null;
    const whenTs   = parseWhenTs(whenText);

    if (country) {
      await env.db.prepare(
        'UPDATE bests_beers SET country_territory = ?, updated_at = ? WHERE LOWER(brewery) = LOWER(?) AND LOWER(product) = LOWER(?) AND country_territory IS NULL'
      ).bind(country, now, brewery, product).run();
    }
    if (whenTs !== null) {
      await env.db.prepare(
        'UPDATE bests_beers SET when_ts = ?, updated_at = ? WHERE LOWER(brewery) = LOWER(?) AND LOWER(product) = LOWER(?) AND when_ts IS NULL'
      ).bind(whenTs, now, brewery, product).run();
    }
  }
}

// ── scoring ───────────────────────────────────────────────────────────────────

function computeScore(rankIndex, total) {
  if (total <= 2) return null;
  return Math.round(10 * (1 - (rankIndex / (total - 1))) * 10) / 10;
}

async function recomputeTypeScores(env, type) {
  const rows = await env.db.prepare(
    'SELECT id, rank_index FROM bests_beers WHERE type = ? ORDER BY rank_index ASC'
  ).bind(type).all();
  const beers = rows.results || [];
  const n = beers.length;
  const now = Math.floor(Date.now() / 1000);
  await Promise.all(beers.map(b => {
    const score = computeScore(b.rank_index, n);
    return env.db.prepare(
      'UPDATE bests_beers SET score = ?, updated_at = ? WHERE id = ?'
    ).bind(score, now, b.id).run();
  }));
}

// ── permission guard ──────────────────────────────────────────────────────────

function isAllowed(username, env) {
  const raw = env.BESTS_ALLOWED_USERS || '';
  if (!raw.trim()) return false;
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    .includes(username.toLowerCase());
}

// ── seed from Google Sheet ────────────────────────────────────────────────────

async function seedFromSheet(env, userId) {
  const sheetId = env.BESTS_SHEET_ID;
  if (!sheetId) return;

  let csvText;
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`);
    if (!res.ok) return;
    csvText = await res.text();
  } catch { return; }

  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return;

  const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase().trim());
  const col = name => headers.indexOf(name);

  const colFirst = (...names) => names.reduce((f, n) => f >= 0 ? f : col(n), -1);

  const iBrewery        = colFirst('brewery');
  const iProduct        = colFirst('product');
  const iCountry        = colFirst('country/territory', 'country / territory', 'country', 'origin', 'beer country');
  const iType           = colFirst('type');
  const iSubType        = colFirst('sub-type', 'subtype', 'sub_type');
  const iWhereName      = colFirst('where (name)', 'where name', 'venue');
  const iWhereCityState = colFirst('where (city/state)', 'where (city)', 'city/state', 'city');
  const iWhereCountry   = colFirst('where (country)', 'where country');
  const iWhen           = colFirst('when', 'date');
  const iNotes          = colFirst('event notes', 'notes');
  const iRating         = colFirst('rating', 'score');

  if (iBrewery < 0 || iProduct < 0 || iType < 0) return;

  const parsed = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    const brewery = (cols[iBrewery] || '').trim();
    const product = (cols[iProduct] || '').trim();
    const type    = (cols[iType]    || '').trim();
    if (!brewery || !product || !type) continue;
    const rating = iRating >= 0 ? parseFloat(cols[iRating]) : NaN;
    parsed.push({
      brewery, product, type,
      country_territory: iCountry >= 0        ? (cols[iCountry] || '').trim()        || null : null,
      sub_type:          iSubType >= 0         ? (cols[iSubType] || '').trim()        || null : null,
      where_name:        iWhereName >= 0       ? (cols[iWhereName] || '').trim()      || null : null,
      where_city_state:  iWhereCityState >= 0  ? (cols[iWhereCityState] || '').trim() || null : null,
      where_country:     iWhereCountry >= 0    ? (cols[iWhereCountry] || '').trim()   || null : null,
      when_text:         iWhen >= 0            ? (cols[iWhen] || '').trim()           || null : null,
      event_notes:       iNotes >= 0           ? (cols[iNotes] || '').trim()          || null : null,
      when_ts:           iWhen >= 0            ? parseWhenTs((cols[iWhen] || '').trim()) : null,
      rating: isNaN(rating) ? -Infinity : rating,
    });
  }

  const byType = new Map();
  for (const r of parsed) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push(r);
  }
  for (const group of byType.values()) group.sort((a, b) => b.rating - a.rating);

  const now = Math.floor(Date.now() / 1000);
  for (const [, group] of byType) {
    const n = group.length;
    for (let i = 0; i < n; i++) {
      const r = group[i];
      await env.db.prepare(`
        INSERT INTO bests_beers
          (brewery, product, country_territory, type, sub_type,
           where_name, where_city_state, where_country, when_text, when_ts, event_notes,
           rank_index, score, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        r.brewery, r.product, r.country_territory, r.type, r.sub_type,
        r.where_name, r.where_city_state, r.where_country, r.when_text, r.when_ts, r.event_notes,
        i, computeScore(i, n), userId, now, now
      ).run();
    }
  }
}

function parseCSVRow(line) {
  const cols = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuote = false; }
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { cols.push(cur); cur = ''; }
      else cur += c;
    }
  }
  cols.push(cur);
  return cols;
}

// ── binary-search ranking ─────────────────────────────────────────────────────

async function startRankSession(env, newBeer, userId) {
  const now = Math.floor(Date.now() / 1000);
  const countRow = await env.db.prepare(
    'SELECT COUNT(*) AS cnt FROM bests_beers WHERE type = ? AND id != ?'
  ).bind(newBeer.type, newBeer.id).first();
  const n = countRow?.cnt ?? 0;

  if (n === 0) {
    await env.db.prepare(
      'UPDATE bests_beers SET rank_index = 0, score = NULL, updated_at = ? WHERE id = ?'
    ).bind(now, newBeer.id).run();
    return { completed: true, insertion_index: 0 };
  }

  const mid = Math.floor(n / 2);
  const candidate = await env.db.prepare(
    'SELECT * FROM bests_beers WHERE type = ? AND id != ? ORDER BY rank_index ASC LIMIT 1 OFFSET ?'
  ).bind(newBeer.type, newBeer.id, mid).first();

  const sessionId = crypto.randomUUID();
  await env.db.prepare(`
    INSERT INTO bests_rank_sessions
      (id, new_beer_id, beer_type, low_index, high_index, candidate_beer_id, status, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(sessionId, newBeer.id, newBeer.type, 0, n, candidate?.id ?? null, 'active', userId, now, now).run();

  return { session_id: sessionId, candidate };
}

async function advanceSession(env, session, winner) {
  const now = Math.floor(Date.now() / 1000);
  let { low_index: low, high_index: high } = session;
  const mid = Math.floor((low + high) / 2);

  await env.db.prepare(
    'INSERT INTO bests_rank_choices (session_id, candidate_beer_id, winner_beer_id, created_at) VALUES (?,?,?,?)'
  ).bind(
    session.id,
    session.candidate_beer_id,
    winner === 'new' ? session.new_beer_id : session.candidate_beer_id,
    now
  ).run();

  if (winner === 'new') high = mid; else low = mid + 1;

  if (low === high) {
    const insertionIndex = low;
    await env.db.prepare(`
      UPDATE bests_beers SET rank_index = rank_index + 1, updated_at = ?
      WHERE type = ? AND id != ? AND rank_index >= ?
    `).bind(now, session.beer_type, session.new_beer_id, insertionIndex).run();
    await env.db.prepare(
      'UPDATE bests_beers SET rank_index = ?, updated_at = ? WHERE id = ?'
    ).bind(insertionIndex, now, session.new_beer_id).run();
    await recomputeTypeScores(env, session.beer_type);
    await env.db.prepare(
      'UPDATE bests_rank_sessions SET status = ?, low_index = ?, high_index = ?, updated_at = ? WHERE id = ?'
    ).bind('completed', low, high, now, session.id).run();
    return { completed: true, insertion_index: insertionIndex };
  }

  const newMid = Math.floor((low + high) / 2);
  const candidate = await env.db.prepare(
    'SELECT * FROM bests_beers WHERE type = ? AND id != ? ORDER BY rank_index ASC LIMIT 1 OFFSET ?'
  ).bind(session.beer_type, session.new_beer_id, newMid).first();
  await env.db.prepare(`
    UPDATE bests_rank_sessions SET low_index = ?, high_index = ?, candidate_beer_id = ?, updated_at = ? WHERE id = ?
  `).bind(low, high, candidate?.id ?? null, now, session.id).run();
  return { session_id: session.id, candidate };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// ── handlers ──────────────────────────────────────────────────────────────────

async function handleVerifyAccess(request, env, userId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { password } = body || {};
  if (!password) return json({ error: 'password required' }, 400);

  const userFull = await env.db.prepare(
    'SELECT password_hash, salt, iterations FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!userFull) return json({ error: 'unauthorized' }, 401);

  const hash = await pbkdf2Hex(password, userFull.salt, userFull.iterations);
  if (!(await timingSafeHashEqual(hash, userFull.password_hash))) {
    return json({ error: 'invalid password' }, 401);
  }

  const token = await mintBestsToken(userId, env);
  return json({ token });
}

async function handleGet(env, userId) {
  await ensureWhenTsColumn(env);
  await ensureHistoryTable(env);

  const countRow = await env.db.prepare('SELECT COUNT(*) AS cnt FROM bests_beers').first();
  if ((countRow?.cnt ?? 0) === 0) {
    await seedFromSheet(env, userId);
  } else {
    // migrate when_ts for existing records
    await migrateWhenTs(env);
    // sync country from sheet if all beers are missing it
    const withCountry = await env.db.prepare(
      'SELECT COUNT(*) AS cnt FROM bests_beers WHERE country_territory IS NOT NULL'
    ).first();
    if ((withCountry?.cnt ?? 0) === 0) await syncCountriesFromSheet(env);
  }

  const [beersResult, sessionRow] = await Promise.all([
    env.db.prepare('SELECT * FROM bests_beers ORDER BY type ASC, rank_index ASC').all(),
    env.db.prepare(
      "SELECT * FROM bests_rank_sessions WHERE created_by = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
    ).bind(userId).first(),
  ]);

  const beers = beersResult.results || [];
  const byType = {};
  for (const b of beers) {
    if (!byType[b.type]) byType[b.type] = [];
    byType[b.type].push(b);
  }

  let activeSession = null;
  if (sessionRow) {
    const [newBeer, candidate] = await Promise.all([
      env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(sessionRow.new_beer_id).first(),
      sessionRow.candidate_beer_id
        ? env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(sessionRow.candidate_beer_id).first()
        : Promise.resolve(null),
    ]);
    activeSession = { ...sessionRow, new_beer: newBeer, candidate_beer: candidate };
  }

  return json({ beers_by_type: byType, active_session: activeSession });
}

async function handlePost(request, env, userId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { action } = body || {};

  if (action === 'create_beer') {
    const b = body.beer || {};
    const { brewery, product, type } = b;
    if (!brewery || !product || !type) return json({ error: 'brewery, product, and type are required' }, 400);

    const now = Math.floor(Date.now() / 1000);
    await env.db.prepare(
      "UPDATE bests_rank_sessions SET status = 'cancelled', updated_at = ? WHERE created_by = ? AND status = 'active'"
    ).bind(now, userId).run();

    const result = await env.db.prepare(`
      INSERT INTO bests_beers
        (brewery, product, country_territory, type, sub_type,
         where_name, where_city_state, where_country, when_text, when_ts, event_notes,
         rank_index, score, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)
    `).bind(
      brewery, product,
      b.country_territory || null, type, b.sub_type || null,
      b.where_name || null, b.where_city_state || null, b.where_country || null,
      b.when_text || null, parseWhenTs(b.when_text || null), b.event_notes || null,
      userId, now, now
    ).run();

    const newBeerId = result.meta?.last_row_id;
    const newBeer = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(newBeerId).first();
    await logHistory(env, newBeerId, 'create', newBeer, userId);
    const outcome = await startRankSession(env, newBeer, userId);

    if (outcome.completed) {
      await recomputeTypeScores(env, newBeer.type);
      const updatedBeer = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(newBeerId).first();
      return json({ created_beer: updatedBeer, completed: true, insertion_index: outcome.insertion_index });
    }
    return json({ created_beer: newBeer, session_id: outcome.session_id, next_comparison: { candidate: outcome.candidate } });
  }

  if (action === 'submit_choice') {
    const { session_id, winner } = body;
    if (!session_id || !winner) return json({ error: 'session_id and winner required' }, 400);
    if (winner !== 'new' && winner !== 'candidate') return json({ error: 'winner must be "new" or "candidate"' }, 400);
    const session = await env.db.prepare(
      "SELECT * FROM bests_rank_sessions WHERE id = ? AND created_by = ? AND status = 'active'"
    ).bind(session_id, userId).first();
    if (!session) return json({ error: 'session not found' }, 404);
    const outcome = await advanceSession(env, session, winner);
    if (outcome.completed) {
      const updatedBeer = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(session.new_beer_id).first();
      return json({ completed: true, insertion_index: outcome.insertion_index, updated_beer: updatedBeer });
    }
    return json({ session_id: session.id, next_comparison: { candidate: outcome.candidate } });
  }

  if (action === 'cancel_session') {
    const { session_id } = body;
    if (!session_id) return json({ error: 'session_id required' }, 400);
    await env.db.prepare(
      "UPDATE bests_rank_sessions SET status = 'cancelled', updated_at = ? WHERE id = ? AND created_by = ?"
    ).bind(Math.floor(Date.now() / 1000), session_id, userId).run();
    return json({ ok: true });
  }

  if (action === 'update_beer') {
    const { beer_id, updates } = body;
    if (!beer_id || !updates) return json({ error: 'beer_id and updates required' }, 400);
    const existing = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(beer_id).first();
    if (!existing) return json({ error: 'not found' }, 404);

    const EDITABLE = ['brewery', 'product', 'country_territory', 'sub_type',
                      'where_name', 'where_city_state', 'where_country', 'when_text', 'event_notes'];
    const fields = [], vals = [];
    for (const key of EDITABLE) {
      if (key in updates) { fields.push(key + ' = ?'); vals.push(updates[key] ?? null); }
    }
    if ('when_text' in updates) { fields.push('when_ts = ?'); vals.push(parseWhenTs(updates.when_text)); }
    if (!fields.length) return json({ error: 'no valid fields' }, 400);

    await logHistory(env, beer_id, 'update', existing, userId);
    const now = Math.floor(Date.now() / 1000);
    fields.push('updated_at = ?'); vals.push(now); vals.push(beer_id);
    await env.db.prepare(`UPDATE bests_beers SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
    const updated = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(beer_id).first();
    return json({ updated_beer: updated });
  }

  if (action === 'delete_beer') {
    const { beer_id } = body;
    if (!beer_id) return json({ error: 'beer_id required' }, 400);
    const beer = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(beer_id).first();
    if (!beer) return json({ error: 'not found' }, 404);
    await logHistory(env, beer_id, 'delete', beer, userId);
    const now = Math.floor(Date.now() / 1000);
    await env.db.prepare(
      "UPDATE bests_rank_sessions SET status = 'cancelled', updated_at = ? WHERE new_beer_id = ? AND status = 'active'"
    ).bind(now, beer_id).run();
    await env.db.prepare('DELETE FROM bests_beers WHERE id = ?').bind(beer_id).run();
    if (beer.rank_index != null) {
      await env.db.prepare(
        'UPDATE bests_beers SET rank_index = rank_index - 1, updated_at = ? WHERE type = ? AND rank_index > ?'
      ).bind(now, beer.type, beer.rank_index).run();
    }
    await recomputeTypeScores(env, beer.type);
    return json({ ok: true });
  }

  if (action === 'export') {
    const result = await env.db.prepare('SELECT * FROM bests_beers ORDER BY type ASC, rank_index ASC').all();
    return json({ beers: result.results || [], exported_at: Math.floor(Date.now() / 1000) });
  }

  return json({ error: 'unknown action' }, 400);
}

// ── main export ───────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.db) return json({ error: 'server error' }, 500);

  const session = await verifySession(request, env);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const user = await env.db.prepare('SELECT id, username FROM users WHERE id = ?').bind(session.user_id).first();
  if (!user) return json({ error: 'unauthorized' }, 401);

  if (!isAllowed(user.username, env)) return json({ error: 'forbidden' }, 403);

  const method = request.method.toUpperCase();

  // verify_access is the only POST that doesn't need the bests token
  if (method === 'POST') {
    let bodyClone;
    try { bodyClone = await request.clone().json(); } catch { return json({ error: 'bad request' }, 400); }
    if (bodyClone?.action === 'verify_access') {
      return handleVerifyAccess(request, env, user.id);
    }
  }

  // all other routes require a valid bests token
  const token = request.headers.get('X-Bests-Token');
  const tokenOk = await verifyBestsToken(token, user.id, env);
  if (!tokenOk) return json({ error: 'token required' }, 401);

  if (method === 'GET') return handleGet(env, user.id);
  if (method === 'POST') return handlePost(request, env, user.id);
  return json({ error: 'method not allowed' }, 405);
}
