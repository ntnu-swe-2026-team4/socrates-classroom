ALTER TABLE users DROP COLUMN role;

CREATE TABLE solo_chats (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX solo_chats_owner ON solo_chats(user_id, updated_at);
