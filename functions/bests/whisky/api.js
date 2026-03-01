import { verifySession } from '../../_auth.js';

const DEFAULT_SHEET_ID = '1BRwJfl8um0kcH6uaCjVAFAZ5sCyoADc9MMTNGHBVXjc';

// ── date helpers ──────────────────────────────────────────────────────────────

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

// ── table setup ───────────────────────────────────────────────────────────────

async function ensureTables(env) {
  try {
    await env.db.prepare(`
      CREATE TABLE IF NOT EXISTS bests_whiskies (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        distillery        TEXT NOT NULL,
        product           TEXT NOT NULL,
        country_territory TEXT,
        age               TEXT,
        type              TEXT NOT NULL,
        where_name        TEXT,
        where_city_state  TEXT,
        where_country     TEXT,
        when_text         TEXT,
        when_ts           INTEGER,
        notes             TEXT,
        rank_index        INTEGER,
        score             REAL,
        created_by        INTEGER NOT NULL,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
      )
    `).run();
    await env.db.prepare(`
      CREATE TABLE IF NOT EXISTS bests_whisky_rank_sessions (
        id                  TEXT PRIMARY KEY,
        new_whisky_id       INTEGER NOT NULL,
        whisky_type         TEXT NOT NULL,
        low_index           INTEGER NOT NULL,
        high_index          INTEGER NOT NULL,
        candidate_whisky_id INTEGER,
        status              TEXT NOT NULL,
        created_by          INTEGER NOT NULL,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      )
    `).run();
    await env.db.prepare(`
      CREATE TABLE IF NOT EXISTS bests_whisky_rank_choices (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id          TEXT NOT NULL,
        candidate_whisky_id INTEGER NOT NULL,
        winner_whisky_id    INTEGER NOT NULL,
        created_at          INTEGER NOT NULL
      )
    `).run();
    await env.db.prepare(`
      CREATE TABLE IF NOT EXISTS bests_whisky_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        whisky_id  INTEGER NOT NULL,
        action     TEXT NOT NULL,
        snapshot   TEXT NOT NULL,
        changed_by INTEGER NOT NULL,
        changed_at INTEGER NOT NULL
      )
    `).run();
    await env.db.prepare('CREATE INDEX IF NOT EXISTS bests_whiskies_type_rank ON bests_whiskies (type, rank_index)').run();
    await env.db.prepare('CREATE INDEX IF NOT EXISTS bests_whisky_sessions_user_status ON bests_whisky_rank_sessions (created_by, status)').run();
    await env.db.prepare('CREATE INDEX IF NOT EXISTS bests_whiskies_type_product ON bests_whiskies (type, product)').run();
    await env.db.prepare('CREATE INDEX IF NOT EXISTS bests_whisky_history_whisky ON bests_whisky_history (whisky_id, changed_at)').run();
  } catch { /* ok */ }
}

// ── scoring ───────────────────────────────────────────────────────────────────

function computeScore(rankIndex, total) {
  if (total <= 2) return null;
  return Math.round(10 * (1 - (rankIndex / (total - 1))) * 10) / 10;
}

async function recomputeTypeScores(env, type) {
  const rows = await env.db.prepare(
    'SELECT id, rank_index FROM bests_whiskies WHERE type = ? ORDER BY rank_index ASC'
  ).bind(type).all();
  const whiskies = rows.results || [];
  const n = whiskies.length;
  const now = Math.floor(Date.now() / 1000);
  await Promise.all(whiskies.map(w => {
    const score = computeScore(w.rank_index, n);
    return env.db.prepare(
      'UPDATE bests_whiskies SET score = ?, updated_at = ? WHERE id = ?'
    ).bind(score, now, w.id).run();
  }));
}

// ── permission guard ──────────────────────────────────────────────────────────

function isAllowed(username, env) {
  const raw = env.BESTS_ALLOWED_USERS || '';
  if (!raw.trim()) return false;
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    .includes(username.toLowerCase());
}

// ── history ───────────────────────────────────────────────────────────────────

async function logHistory(env, whiskyId, action, snapshot, userId) {
  try {
    await env.db.prepare(
      'INSERT INTO bests_whisky_history (whisky_id, action, snapshot, changed_by, changed_at) VALUES (?,?,?,?,?)'
    ).bind(whiskyId, action, JSON.stringify(snapshot), userId, Math.floor(Date.now() / 1000)).run();
  } catch { /* non-fatal */ }
}

// ── CSV parser ────────────────────────────────────────────────────────────────

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

// ── seed from Google Sheet ────────────────────────────────────────────────────

async function seedFromSheet(env, userId) {
  const sheetId = env.BESTS_WHISKY_SHEET_ID || DEFAULT_SHEET_ID;

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

  const iDistillery    = colFirst('distillery');
  const iProduct       = colFirst('product');
  const iCountry       = colFirst('country / territory', 'country/territory', 'country', 'origin');
  const iAge           = colFirst('age');
  const iType          = colFirst('type');
  const iWhereName     = colFirst('where', 'where (name)', 'venue');
  const iWhereCityState = colFirst('where (city, state)', 'where (city,state)', 'where (city/state)', 'city/state', 'city');
  const iWhereCountry  = colFirst('where (country)', 'where country');
  const iWhen          = colFirst('when', 'date');
  const iNotes         = colFirst('notes', 'event notes');
  const iRating        = colFirst('rating', 'score');

  if (iDistillery < 0 || iProduct < 0 || iType < 0) return;

  const parsed = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    const distillery = (cols[iDistillery] || '').trim();
    const product    = (cols[iProduct]    || '').trim();
    const type       = (cols[iType]       || '').trim();
    if (!distillery || !product || !type) continue;
    const ratingRaw = iRating >= 0 ? (cols[iRating] || '').trim() : '';
    const rating = ratingRaw === '' || ratingRaw === '-' ? -Infinity : parseFloat(ratingRaw);
    parsed.push({
      distillery, product, type,
      country_territory: iCountry >= 0       ? (cols[iCountry] || '').trim()        || null : null,
      age:               iAge >= 0           ? (cols[iAge] || '').trim()             || null : null,
      where_name:        iWhereName >= 0     ? (cols[iWhereName] || '').trim()       || null : null,
      where_city_state:  iWhereCityState >= 0 ? (cols[iWhereCityState] || '').trim() || null : null,
      where_country:     iWhereCountry >= 0  ? (cols[iWhereCountry] || '').trim()    || null : null,
      when_text:         iWhen >= 0          ? (cols[iWhen] || '').trim()            || null : null,
      notes:             iNotes >= 0         ? (cols[iNotes] || '').trim()           || null : null,
      when_ts:           iWhen >= 0          ? parseWhenTs((cols[iWhen] || '').trim()) : null,
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
        INSERT INTO bests_whiskies
          (distillery, product, country_territory, age, type,
           where_name, where_city_state, where_country, when_text, when_ts, notes,
           rank_index, score, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        r.distillery, r.product, r.country_territory, r.age, r.type,
        r.where_name, r.where_city_state, r.where_country, r.when_text, r.when_ts, r.notes,
        i, computeScore(i, n), userId, now, now
      ).run();
    }
  }
}

// ── binary-search ranking ─────────────────────────────────────────────────────

async function startRankSession(env, newWhisky, userId) {
  const now = Math.floor(Date.now() / 1000);
  const countRow = await env.db.prepare(
    'SELECT COUNT(*) AS cnt FROM bests_whiskies WHERE type = ? AND id != ?'
  ).bind(newWhisky.type, newWhisky.id).first();
  const n = countRow?.cnt ?? 0;

  if (n === 0) {
    await env.db.prepare(
      'UPDATE bests_whiskies SET rank_index = 0, score = NULL, updated_at = ? WHERE id = ?'
    ).bind(now, newWhisky.id).run();
    return { completed: true, insertion_index: 0 };
  }

  const mid = Math.floor(n / 2);
  const candidate = await env.db.prepare(
    'SELECT * FROM bests_whiskies WHERE type = ? AND id != ? ORDER BY rank_index ASC LIMIT 1 OFFSET ?'
  ).bind(newWhisky.type, newWhisky.id, mid).first();

  const sessionId = crypto.randomUUID();
  await env.db.prepare(`
    INSERT INTO bests_whisky_rank_sessions
      (id, new_whisky_id, whisky_type, low_index, high_index, candidate_whisky_id, status, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(sessionId, newWhisky.id, newWhisky.type, 0, n, candidate?.id ?? null, 'active', userId, now, now).run();

  return { session_id: sessionId, candidate };
}

async function advanceSession(env, session, winner) {
  const now = Math.floor(Date.now() / 1000);
  let { low_index: low, high_index: high } = session;
  const mid = Math.floor((low + high) / 2);

  await env.db.prepare(
    'INSERT INTO bests_whisky_rank_choices (session_id, candidate_whisky_id, winner_whisky_id, created_at) VALUES (?,?,?,?)'
  ).bind(
    session.id,
    session.candidate_whisky_id,
    winner === 'new' ? session.new_whisky_id : session.candidate_whisky_id,
    now
  ).run();

  if (winner === 'new') high = mid; else low = mid + 1;

  if (low === high) {
    const insertionIndex = low;
    await env.db.prepare(`
      UPDATE bests_whiskies SET rank_index = rank_index + 1, updated_at = ?
      WHERE type = ? AND id != ? AND rank_index >= ?
    `).bind(now, session.whisky_type, session.new_whisky_id, insertionIndex).run();
    await env.db.prepare(
      'UPDATE bests_whiskies SET rank_index = ?, updated_at = ? WHERE id = ?'
    ).bind(insertionIndex, now, session.new_whisky_id).run();
    await recomputeTypeScores(env, session.whisky_type);
    await env.db.prepare(
      'UPDATE bests_whisky_rank_sessions SET status = ?, low_index = ?, high_index = ?, updated_at = ? WHERE id = ?'
    ).bind('completed', low, high, now, session.id).run();
    return { completed: true, insertion_index: insertionIndex };
  }

  const newMid = Math.floor((low + high) / 2);
  const candidate = await env.db.prepare(
    'SELECT * FROM bests_whiskies WHERE type = ? AND id != ? ORDER BY rank_index ASC LIMIT 1 OFFSET ?'
  ).bind(session.whisky_type, session.new_whisky_id, newMid).first();
  await env.db.prepare(`
    UPDATE bests_whisky_rank_sessions SET low_index = ?, high_index = ?, candidate_whisky_id = ?, updated_at = ? WHERE id = ?
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
  await ensureTables(env);

  const countRow = await env.db.prepare('SELECT COUNT(*) AS cnt FROM bests_whiskies').first();
  if ((countRow?.cnt ?? 0) === 0) {
    await seedFromSheet(env, userId);
  }

  const [whiskiesResult, sessionRow] = await Promise.all([
    env.db.prepare('SELECT * FROM bests_whiskies ORDER BY type ASC, rank_index ASC').all(),
    env.db.prepare(
      "SELECT * FROM bests_whisky_rank_sessions WHERE created_by = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
    ).bind(userId).first(),
  ]);

  const whiskies = whiskiesResult.results || [];
  const byType = {};
  for (const w of whiskies) {
    if (!byType[w.type]) byType[w.type] = [];
    byType[w.type].push(w);
  }

  let activeSession = null;
  if (sessionRow) {
    const [newWhisky, candidate] = await Promise.all([
      env.db.prepare('SELECT * FROM bests_whiskies WHERE id = ?').bind(sessionRow.new_whisky_id).first(),
      sessionRow.candidate_whisky_id
        ? env.db.prepare('SELECT * FROM bests_whiskies WHERE id = ?').bind(sessionRow.candidate_whisky_id).first()
        : Promise.resolve(null),
    ]);
    activeSession = { ...sessionRow, new_whisky: newWhisky, candidate_whisky: candidate };
  }

  return json({ whiskies_by_type: byType, active_session: activeSession });
}

async function handlePost(request, env, userId) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { action } = body || {};

  if (action === 'create_whisky') {
    const w = body.whisky || {};
    const { distillery, product, type } = w;
    if (!distillery || !product || !type) return json({ error: 'distillery, product, and type are required' }, 400);

    const now = Math.floor(Date.now() / 1000);
    await env.db.prepare(
      "UPDATE bests_whisky_rank_sessions SET status = 'cancelled', updated_at = ? WHERE created_by = ? AND status = 'active'"
    ).bind(now, userId).run();

    const result = await env.db.prepare(`
      INSERT INTO bests_whiskies
        (distillery, product, country_territory, age, type,
         where_name, where_city_state, where_country, when_text, when_ts, notes,
         rank_index, score, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)
    `).bind(
      distillery, product,
      w.country_territory || null, w.age || null, type,
      w.where_name || null, w.where_city_state || null, w.where_country || null,
      w.when_text || null, parseWhenTs(w.when_text || null), w.notes || null,
      userId, now, now
    ).run();

    const newWhiskyId = result.meta?.last_row_id;
    const newWhisky = await env.db.prepare('SELECT * FROM bests_whiskies WHERE id = ?').bind(newWhiskyId).first();
    await logHistory(env, newWhiskyId, 'create', newWhisky, userId);
    const outcome = await startRankSession(env, newWhisky, userId);

    if (outcome.completed) {
      await recomputeTypeScores(env, newWhisky.type);
      const updatedWhisky = await env.db.prepare('SELECT * FROM bests_whiskies WHERE id = ?').bind(newWhiskyId).first();
      return json({ created_whisky: updatedWhisky, completed: true, insertion_index: outcome.insertion_index });
    }
    return json({ created_whisky: newWhisky, session_id: outcome.session_id, next_comparison: { candidate: outcome.candidate } });
  }

  if (action === 'submit_choice') {
    const { session_id, winner } = body;
    if (!session_id || !winner) return json({ error: 'session_id and winner required' }, 400);
    if (winner !== 'new' && winner !== 'candidate') return json({ error: 'winner must be "new" or "candidate"' }, 400);
    const session = await env.db.prepare(
      "SELECT * FROM bests_whisky_rank_sessions WHERE id = ? AND created_by = ? AND status = 'active'"
    ).bind(session_id, userId).first();
    if (!session) return json({ error: 'session not found' }, 404);
    const outcome = await advanceSession(env, session, winner);
    if (outcome.completed) {
      const updatedWhisky = await env.db.prepare('SELECT * FROM bests_whiskies WHERE id = ?').bind(session.new_whisky_id).first();
      return json({ completed: true, insertion_index: outcome.insertion_index, updated_whisky: updatedWhisky });
    }
    return json({ session_id: session.id, next_comparison: { candidate: outcome.candidate } });
  }

  if (action === 'cancel_session') {
    const { session_id } = body;
    if (!session_id) return json({ error: 'session_id required' }, 400);
    await env.db.prepare(
      "UPDATE bests_whisky_rank_sessions SET status = 'cancelled', updated_at = ? WHERE id = ? AND created_by = ?"
    ).bind(Math.floor(Date.now() / 1000), session_id, userId).run();
    return json({ ok: true });
  }

  if (action === 'update_whisky') {
    const { whisky_id, updates } = body;
    if (!whisky_id || !updates) return json({ error: 'whisky_id and updates required' }, 400);
    const existing = await env.db.prepare('SELECT * FROM bests_whiskies WHERE id = ?').bind(whisky_id).first();
    if (!existing) return json({ error: 'not found' }, 404);

    const EDITABLE = ['distillery', 'product', 'country_territory', 'age',
                      'where_name', 'where_city_state', 'where_country', 'when_text', 'notes'];
    const fields = [], vals = [];
    for (const key of EDITABLE) {
      if (key in updates) { fields.push(key + ' = ?'); vals.push(updates[key] ?? null); }
    }
    if ('when_text' in updates) { fields.push('when_ts = ?'); vals.push(parseWhenTs(updates.when_text)); }

    const typeChanging = 'type' in updates && updates.type && updates.type !== existing.type;
    if (typeChanging) { fields.push('type = ?'); vals.push(updates.type); }

    if (!fields.length) return json({ error: 'no valid fields' }, 400);

    await logHistory(env, whisky_id, 'update', existing, userId);
    const now = Math.floor(Date.now() / 1000);
    fields.push('updated_at = ?'); vals.push(now); vals.push(whisky_id);
    await env.db.prepare(`UPDATE bests_whiskies SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();

    if (typeChanging) {
      // compact old type rank gap
      if (existing.rank_index != null) {
        await env.db.prepare(
          'UPDATE bests_whiskies SET rank_index = rank_index - 1, updated_at = ? WHERE type = ? AND rank_index > ?'
        ).bind(now, existing.type, existing.rank_index).run();
      }
      await recomputeTypeScores(env, existing.type);
      // append to end of new type
      const tailRow = await env.db.prepare(
        'SELECT COUNT(*) AS cnt FROM bests_whiskies WHERE type = ? AND id != ?'
      ).bind(updates.type, whisky_id).first();
      const newIndex = tailRow?.cnt ?? 0;
      await env.db.prepare(
        'UPDATE bests_whiskies SET rank_index = ?, updated_at = ? WHERE id = ?'
      ).bind(newIndex, now, whisky_id).run();
      await recomputeTypeScores(env, updates.type);
    }

    const updated = await env.db.prepare('SELECT * FROM bests_whiskies WHERE id = ?').bind(whisky_id).first();
    return json({ updated_whisky: updated });
  }

  if (action === 'delete_whisky') {
    const { whisky_id } = body;
    if (!whisky_id) return json({ error: 'whisky_id required' }, 400);
    const whisky = await env.db.prepare('SELECT * FROM bests_whiskies WHERE id = ?').bind(whisky_id).first();
    if (!whisky) return json({ error: 'not found' }, 404);
    await logHistory(env, whisky_id, 'delete', whisky, userId);
    const now = Math.floor(Date.now() / 1000);
    await env.db.prepare(
      "UPDATE bests_whisky_rank_sessions SET status = 'cancelled', updated_at = ? WHERE new_whisky_id = ? AND status = 'active'"
    ).bind(now, whisky_id).run();
    await env.db.prepare('DELETE FROM bests_whiskies WHERE id = ?').bind(whisky_id).run();
    if (whisky.rank_index != null) {
      await env.db.prepare(
        'UPDATE bests_whiskies SET rank_index = rank_index - 1, updated_at = ? WHERE type = ? AND rank_index > ?'
      ).bind(now, whisky.type, whisky.rank_index).run();
    }
    await recomputeTypeScores(env, whisky.type);
    return json({ ok: true });
  }

  if (action === 'export') {
    const result = await env.db.prepare('SELECT * FROM bests_whiskies ORDER BY type ASC, rank_index ASC').all();
    return json({ whiskies: result.results || [], exported_at: Math.floor(Date.now() / 1000) });
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
