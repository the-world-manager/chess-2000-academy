CREATE TABLE chess_accounts (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), profile_json TEXT NOT NULL DEFAULT '{}',stats_json TEXT NOT NULL DEFAULT '{}',
 last_sync TEXT, next_retry_at BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE games (
 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),source_key TEXT NOT NULL,source_url TEXT NOT NULL,
 ended_at BIGINT NOT NULL,opponent TEXT NOT NULL,color TEXT NOT NULL,result TEXT NOT NULL,time_class TEXT NOT NULL,
 time_control TEXT NOT NULL,rating INTEGER,opponent_rating INTEGER,opening TEXT,pgn TEXT NOT NULL,imported_at TEXT NOT NULL,
 UNIQUE(user_id,source_key)
);
CREATE INDEX games_user_date ON games(user_id,time_class,ended_at);
CREATE TABLE game_analyses (
 game_id TEXT PRIMARY KEY REFERENCES games(id),user_id INTEGER NOT NULL REFERENCES users(id),result_json TEXT NOT NULL,
 status TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE archive_sync (
 user_id INTEGER NOT NULL REFERENCES users(id),time_class TEXT NOT NULL,archive TEXT NOT NULL,synced_at TEXT NOT NULL,
 PRIMARY KEY(user_id,time_class,archive)
);
CREATE TABLE sync_jobs (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),job_id TEXT NOT NULL,time_class TEXT NOT NULL,queue_json TEXT NOT NULL DEFAULT '[]',
 cursor INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,imported INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0,
 lease_until BIGINT NOT NULL DEFAULT 0,state TEXT NOT NULL
);
