ALTER TABLE admin_keys ADD COLUMN zdr_status TEXT NOT NULL DEFAULT 'unverified' CHECK (zdr_status IN ('unverified', 'approved'));
ALTER TABLE admin_keys ADD COLUMN zdr_retention_source TEXT;
ALTER TABLE admin_keys ADD COLUMN zdr_verified_at TEXT;
