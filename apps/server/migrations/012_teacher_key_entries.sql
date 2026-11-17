CREATE TABLE teacher_key_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  key_enc     TEXT NOT NULL,
  last4       TEXT NOT NULL,
  model       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);
CREATE INDEX teacher_key_entries_user ON teacher_key_entries(user_id, sort_order);

INSERT INTO teacher_key_entries (id, user_id, provider_id, key_enc, last4, model, sort_order, updated_at)
SELECT 'k_' || lower(hex(randomblob(16))), user_id, provider_id, key_enc, last4, model, sort_order, updated_at
FROM teacher_keys
WHERE model != '';

DROP TABLE teacher_keys;
