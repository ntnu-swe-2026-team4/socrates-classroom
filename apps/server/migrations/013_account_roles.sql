CREATE TABLE schools (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN teacher_plan TEXT CHECK (teacher_plan IN ('trial', 'school'));
ALTER TABLE users ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN teacher_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN teacher_terms_at TEXT;
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN student_classroom_id TEXT REFERENCES classrooms(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX users_username ON users(username) WHERE username IS NOT NULL;

UPDATE users SET teacher_plan = 'trial', teacher_terms_at = created_at
  WHERE id IN (SELECT teacher_id FROM classrooms);

UPDATE users SET can_manage_classes = 1 WHERE teacher_plan IS NOT NULL;
