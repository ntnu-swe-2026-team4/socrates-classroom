ALTER TABLE users ADD COLUMN can_manage_classes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN disabled_at TEXT;
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

UPDATE users SET can_manage_classes = 1 WHERE role = 'teacher';
