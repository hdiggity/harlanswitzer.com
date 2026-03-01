import { verifySession } from '../_auth.js';

// ── date helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function parseWhenTs(text) {
  if (!text) return null;
  const s = String(text).trim();
  // M/YY, MM/YY, M/YYYY, MM/YYYY
  const m1 = s.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (m1) {
    const month = parseInt(m1[1], 10);
    let year = parseInt(m1[2], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return null;
    return Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  }
  // YYYY (year only)
  const m2 = s.match(/^(\d{4})$/);
  if (m2) return Math.floor(Date.UTC(parseInt(m2[1], 10), 0, 1) / 1000);
  // M-YY or M-YYYY
  const m3 = s.match(/^(\d{1,2})-(\d{2,4})$/);
  if (m3) {
    const month = parseInt(m3[1], 10);
    let year = parseInt(m3[2], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return null;
    return Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  }
  // "Jan 2019", "January 2019", etc.
  const m4 = s.match(/^([a-zA-Z]{3,9})\s+(\d{4})$/);
  if (m4) {
    const month = MONTH_NAMES[m4[1].toLowerCase().slice(0, 3)];
    const year = parseInt(m4[2], 10);
    if (month && year >= 1900 && year <= 2100) return Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  }
  return null;
}

function normalizeWhenText(text) {
  if (!text) return { when_text: null, when_ts: null };
  const s = String(text).trim();
  const ts = parseWhenTs(s);
  if (ts === null) return { when_text: s, when_ts: null };
  const d = new Date(ts * 1000);
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  const normalized = /^\d{4}$/.test(s) ? s : `${month}/${year}`;
  return { when_text: normalized, when_ts: ts };
}

async function normalizeDates(env) {
  const rows = await env.db.prepare(
    'SELECT id, when_text, when_ts FROM bests_beers WHERE when_text IS NOT NULL'
  ).all();
  const now = Math.floor(Date.now() / 1000);
  for (const r of (rows.results || [])) {
    const { when_text, when_ts } = normalizeWhenText(r.when_text);
    if (when_text !== r.when_text || (when_ts !== null && when_ts !== r.when_ts)) {
      await env.db.prepare(
        'UPDATE bests_beers SET when_text = ?, when_ts = ?, updated_at = ? WHERE id = ?'
      ).bind(when_text, when_ts, now, r.id).run().catch(() => {});
    }
  }
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

async function syncFromSheet(env) {
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

  const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase().trim().replace(/\s+/g, ' '));
  const col = name => headers.indexOf(name);
  const colFirst = (...names) => names.reduce((f, n) => f >= 0 ? f : col(n), -1);

  const iBrewery       = colFirst('brewery');
  const iProduct       = colFirst('product');
  const iCountry       = colFirst('country / territory', 'country/territory', 'country', 'origin', 'beer country');
  const iSubType       = colFirst('sub-type', 'subtype', 'sub_type');
  const iWhereName     = colFirst('where (name)', 'where name', 'venue');
  const iWhereCityState = colFirst('where (city/state)', 'where (city)', 'city/state', 'city');
  const iWhereCountry  = colFirst('where (country)', 'where country');
  const iWhen          = colFirst('when', 'date');
  const iNotes         = colFirst('event notes', 'notes');

  if (iBrewery < 0 || iProduct < 0) return;

  const now = Math.floor(Date.now() / 1000);
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    const brewery = (cols[iBrewery] || '').trim();
    const product = (cols[iProduct] || '').trim();
    if (!brewery || !product) continue;

    const v = idx => idx >= 0 ? (cols[idx] || '').trim() || null : null;
    const country        = v(iCountry);
    const subType        = v(iSubType);
    const whereName      = v(iWhereName);
    const whereCityState = v(iWhereCityState);
    const whereCountry   = v(iWhereCountry);
    const whenText       = v(iWhen);
    const whenTs         = parseWhenTs(whenText);
    const notes          = v(iNotes);

    await env.db.prepare(`
      UPDATE bests_beers SET
        country_territory = COALESCE(country_territory, ?),
        sub_type          = COALESCE(sub_type, ?),
        where_name        = COALESCE(where_name, ?),
        where_city_state  = COALESCE(where_city_state, ?),
        where_country     = COALESCE(where_country, ?),
        when_text         = COALESCE(when_text, ?),
        when_ts           = COALESCE(when_ts, ?),
        event_notes       = COALESCE(event_notes, ?),
        updated_at        = ?
      WHERE LOWER(brewery) = LOWER(?) AND LOWER(product) = LOWER(?)
    `).bind(
      country, subType, whereName, whereCityState, whereCountry,
      whenText, whenTs, notes, now, brewery, product
    ).run().catch(() => {});
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

async function handleGet(env, userId) {
  await ensureWhenTsColumn(env);
  await ensureHistoryTable(env);

  const countRow = await env.db.prepare('SELECT COUNT(*) AS cnt FROM bests_beers').first();
  if ((countRow?.cnt ?? 0) === 0) {
    await seedFromSheet(env, userId);
  } else {
    const missingRow = await env.db.prepare(
      'SELECT COUNT(*) AS cnt FROM bests_beers WHERE country_territory IS NULL OR when_ts IS NULL'
    ).first();
    if ((missingRow?.cnt ?? 0) > 0) await syncFromSheet(env);
    await normalizeDates(env);
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

  if (action === 'rerank_beer') {
    const { beer_id } = body;
    if (!beer_id) return json({ error: 'beer_id required' }, 400);
    const beer = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(beer_id).first();
    if (!beer) return json({ error: 'not found' }, 404);
    const now = Math.floor(Date.now() / 1000);
    await env.db.prepare(
      "UPDATE bests_rank_sessions SET status = 'cancelled', updated_at = ? WHERE created_by = ? AND status = 'active'"
    ).bind(now, userId).run();
    if (beer.rank_index != null) {
      await env.db.prepare(
        'UPDATE bests_beers SET rank_index = rank_index - 1, updated_at = ? WHERE type = ? AND id != ? AND rank_index > ?'
      ).bind(now, beer.type, beer_id, beer.rank_index).run();
    }
    await env.db.prepare('UPDATE bests_beers SET rank_index = NULL, score = NULL, updated_at = ? WHERE id = ?').bind(now, beer_id).run();
    await recomputeTypeScores(env, beer.type);
    const outcome = await startRankSession(env, beer, userId);
    if (outcome.completed) {
      await recomputeTypeScores(env, beer.type);
      const updated = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(beer_id).first();
      return json({ created_beer: updated, completed: true });
    }
    const updated = await env.db.prepare('SELECT * FROM bests_beers WHERE id = ?').bind(beer_id).first();
    return json({ created_beer: updated, session_id: outcome.session_id, next_comparison: { candidate: outcome.candidate } });
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

  const user = await env.db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').bind(session.user_id).first();
  if (!user) return json({ error: 'unauthorized' }, 401);

  if (!user.is_admin) return json({ error: 'forbidden' }, 403);

  if (!isAllowed(user.username, env)) return json({ error: 'forbidden' }, 403);

  const method = request.method.toUpperCase();
  if (method === 'GET') return handleGet(env, user.id);
  if (method === 'POST') return handlePost(request, env, user.id);
  return json({ error: 'method not allowed' }, 405);
}
