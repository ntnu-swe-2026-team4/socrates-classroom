ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 1;
UPDATE users SET is_guest = 0 WHERE email IS NOT NULL;
ALTER TABLE users DROP COLUMN role;

CREATE TABLE solo_chats (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX solo_chats_owner ON solo_chats(user_id, updated_at);
