ALTER TABLE users ADD COLUMN usage_quota_tokens INTEGER;

CREATE TABLE usage_months (
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  tokens     INTEGER NOT NULL DEFAULT 0,
  requests   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, month)
);

CREATE TABLE usage_alerts (
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  threshold  INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  emailed_at TEXT,
  PRIMARY KEY (owner_id, month, threshold)
);
CREATE INDEX usage_alerts_pending ON usage_alerts(emailed_at, month);
