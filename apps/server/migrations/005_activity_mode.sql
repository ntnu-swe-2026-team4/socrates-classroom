ALTER TABLE activities ADD COLUMN mode TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'test'));
