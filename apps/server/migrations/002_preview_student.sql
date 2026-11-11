ALTER TABLE users ADD COLUMN preview_classroom_id TEXT REFERENCES classrooms(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX users_preview_classroom ON users(preview_classroom_id) WHERE preview_classroom_id IS NOT NULL;
