CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS login_tokens_expiry ON login_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_requests_created ON auth_requests(created_at);
CREATE INDEX IF NOT EXISTS auth_requests_email ON auth_requests(email_hash, created_at);
CREATE INDEX IF NOT EXISTS auth_requests_ip ON auth_requests(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  american_odds INTEGER NOT NULL CHECK (american_odds >= 100 OR american_odds <= -100),
  stake_cents INTEGER NOT NULL CHECK (stake_cents > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'won', 'lost', 'push')),
  placed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS bets_user_placed ON bets(user_id, placed_at DESC);
