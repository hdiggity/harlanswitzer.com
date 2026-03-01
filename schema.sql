CREATE TABLE IF NOT EXISTS requests (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  host      TEXT,
  path      TEXT,
  method    TEXT,
  status    INTEGER,
  country   TEXT,
  asn       TEXT,
  colo      TEXT,
  user_agent TEXT,
  referer   TEXT,
  ray       TEXT,
  bot_score INTEGER,
  verified_bot INTEGER,
  ip_hash   TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  vid       TEXT,
  sid       TEXT,
  type      TEXT,
  path      TEXT,
  data      TEXT,
  user_agent TEXT,
  referer   TEXT,
  bot_score INTEGER,
  verified_bot INTEGER,
  ip_hash   TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  iterations    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  ts      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_ip_ts ON login_attempts (ip_hash, ts);

CREATE TABLE IF NOT EXISTS bests_beers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  brewery           TEXT NOT NULL,
  product           TEXT NOT NULL,
  country_territory TEXT,
  type              TEXT NOT NULL,
  sub_type          TEXT,
  where_name        TEXT,
  where_city_state  TEXT,
  where_country     TEXT,
  when_text         TEXT,
  event_notes       TEXT,
  rank_index        INTEGER,
  score             REAL,
  when_ts           INTEGER,
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bests_rank_sessions (
  id              TEXT PRIMARY KEY,
  new_beer_id     INTEGER NOT NULL REFERENCES bests_beers(id),
  beer_type       TEXT NOT NULL,
  low_index       INTEGER NOT NULL,
  high_index      INTEGER NOT NULL,
  candidate_beer_id INTEGER,
  status          TEXT NOT NULL,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bests_rank_choices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT NOT NULL REFERENCES bests_rank_sessions(id),
  candidate_beer_id INTEGER NOT NULL REFERENCES bests_beers(id),
  winner_beer_id   INTEGER NOT NULL REFERENCES bests_beers(id),
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bests_beer_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  beer_id    INTEGER NOT NULL,
  action     TEXT NOT NULL,
  snapshot   TEXT NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  changed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS bests_beer_history_beer ON bests_beer_history (beer_id, changed_at);

CREATE INDEX IF NOT EXISTS bests_beers_type_rank    ON bests_beers (type, rank_index);
CREATE INDEX IF NOT EXISTS bests_sessions_user_status ON bests_rank_sessions (created_by, status);
CREATE INDEX IF NOT EXISTS bests_beers_type_product  ON bests_beers (type, product);
