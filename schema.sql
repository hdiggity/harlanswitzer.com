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
