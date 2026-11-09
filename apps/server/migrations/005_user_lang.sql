ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'zh' CHECK (lang IN ('zh', 'en', 'es'));
