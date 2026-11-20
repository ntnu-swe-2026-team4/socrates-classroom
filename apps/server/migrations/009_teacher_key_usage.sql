ALTER TABLE teacher_keys ADD COLUMN monthly_quota_usd REAL;

CREATE TABLE teacher_key_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  billed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_teacher_key_usage_key_time ON teacher_key_usage(user_id, provider_id, created_at);

CREATE TABLE teacher_quota_alerts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  window TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  PRIMARY KEY (user_id, provider_id, window, threshold)
);
