CREATE TABLE schools (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN teacher_plan TEXT CHECK (teacher_plan IN ('trial', 'school'));
ALTER TABLE users ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN teacher_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN teacher_terms_at TEXT;
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN student_classroom_id TEXT REFERENCES classrooms(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN guest_activity_id TEXT;
CREATE UNIQUE INDEX users_username ON users(username) WHERE username IS NOT NULL;

UPDATE users SET teacher_plan = 'trial', teacher_terms_at = created_at
  WHERE is_guest = 0 AND id IN (SELECT teacher_id FROM classrooms);

UPDATE users SET guest_activity_id = (
    SELECT c.current_activity_id FROM members m JOIN classrooms c ON c.id = m.classroom_id
    WHERE m.user_id = users.id ORDER BY m.joined_at DESC LIMIT 1
  )
  WHERE is_guest = 1 AND preview_classroom_id IS NULL;
