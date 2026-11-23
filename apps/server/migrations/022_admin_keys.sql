CREATE TABLE admin_keys (
  id                TEXT PRIMARY KEY,
  provider_id       TEXT NOT NULL UNIQUE,
  key_enc           TEXT NOT NULL,
  last4             TEXT NOT NULL,
  max_concurrency   INTEGER,
  monthly_quota_usd REAL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL
);
CREATE INDEX admin_keys_sort ON admin_keys(sort_order);

CREATE TABLE admin_key_models (
  admin_key_id    TEXT NOT NULL REFERENCES admin_keys(id) ON DELETE CASCADE,
  model           TEXT NOT NULL,
  max_concurrency INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (admin_key_id, model)
);

CREATE TABLE admin_key_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_key_id TEXT NOT NULL REFERENCES admin_keys(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  billed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_admin_key_usage_time ON admin_key_usage(admin_key_id, created_at);

CREATE TABLE admin_quota_alerts (
  admin_key_id TEXT NOT NULL REFERENCES admin_keys(id) ON DELETE CASCADE,
  window TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  PRIMARY KEY (admin_key_id, window, threshold)
);
