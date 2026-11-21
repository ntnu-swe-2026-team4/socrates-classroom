CREATE TABLE notifications (
  id         TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX notifications_created ON notifications(created_at DESC, id DESC);
ALTER TABLE users ADD COLUMN notifications_seen_at TEXT;
