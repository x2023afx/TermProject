CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  password_iterations INTEGER,
  full_name TEXT,
  phone TEXT,
  street_address TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT,
  created_at INTEGER NOT NULL,
  CHECK (
    (password_salt IS NULL AND password_hash IS NULL AND password_iterations IS NULL) OR
    (username IS NOT NULL AND password_salt IS NOT NULL AND password_hash IS NOT NULL AND password_iterations IS NOT NULL)
  )
);

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
