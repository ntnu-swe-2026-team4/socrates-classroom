ALTER TABLE users ADD COLUMN pending_email TEXT NULL;
ALTER TABLE users ADD COLUMN pending_email_at TEXT NULL;
CREATE UNIQUE INDEX users_pending_email ON users(pending_email) WHERE pending_email IS NOT NULL;
