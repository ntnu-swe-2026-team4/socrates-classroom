CREATE INDEX users_student_classroom ON users(student_classroom_id) WHERE student_classroom_id IS NOT NULL;

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT
);
CREATE INDEX audit_log_target ON audit_log(target_id, created_at);
