ALTER TABLE teacher_keys ADD COLUMN disabled_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE teacher_keys ADD COLUMN disabled_at TEXT;
