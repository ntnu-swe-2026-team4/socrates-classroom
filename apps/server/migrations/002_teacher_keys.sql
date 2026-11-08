CREATE TABLE teacher_keys (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  key_enc     TEXT NOT NULL,
  last4       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, provider_id)
);
CREATE INDEX teacher_keys_user ON teacher_keys(user_id, sort_order);
