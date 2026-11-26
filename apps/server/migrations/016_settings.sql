CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE activities ADD COLUMN report_axes TEXT;
