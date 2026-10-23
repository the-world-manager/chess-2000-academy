CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  chess_username TEXT NOT NULL DEFAULT 'alexander_gusev',
  start_rating INTEGER NOT NULL DEFAULT 1437,
  target_rating INTEGER NOT NULL DEFAULT 2000,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS single_owner ON users ((1));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS board_states (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  pgn TEXT NOT NULL DEFAULT '',
  fen TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (
  client_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at BIGINT NOT NULL
);
