PRAGMA foreign_keys = ON;

CREATE TABLE solo_chats (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX solo_chats_owner ON solo_chats(user_id, updated_at);

CREATE TABLE solo_messages (
  id      TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES solo_chats(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text    TEXT NOT NULL,
  at      TEXT NOT NULL
);
CREATE INDEX solo_messages_thread ON solo_messages(chat_id, at);
