ALTER TABLE users ADD COLUMN teacher_request_at TEXT;
CREATE INDEX users_teacher_request ON users(teacher_request_at) WHERE teacher_request_at IS NOT NULL;
