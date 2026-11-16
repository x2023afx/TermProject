ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_iterations INTEGER;

CREATE UNIQUE INDEX users_username ON users(username);
