PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
  email         TEXT UNIQUE,
  password_hash TEXT,
  lang          TEXT NOT NULL DEFAULT 'zh' CHECK (lang IN ('zh', 'en', 'es')),
  created_at    TEXT NOT NULL
);

CREATE TABLE classrooms (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  teacher_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  join_code           TEXT NOT NULL UNIQUE,
  current_activity_id TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE topics (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  statement  TEXT NOT NULL,
  summary    TEXT,
  prompts    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE activities (
  id           TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL REFERENCES topics(id),
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE TABLE members (
  classroom_id   TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  tos_accepted_at TEXT NOT NULL,
  joined_at      TEXT NOT NULL,
  PRIMARY KEY (classroom_id, user_id)
);
CREATE UNIQUE INDEX members_name ON members(classroom_id, name);

CREATE TABLE reports (
  activity_id    TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('pending', 'partial', 'ready', 'failed')),
  teacher_report TEXT,
  student_reports TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE pseudonyms (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pseudonym   TEXT NOT NULL,
  PRIMARY KEY (activity_id, student_id)
);

CREATE TABLE teacher_keys (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  key_enc     TEXT NOT NULL,
  last4       TEXT NOT NULL,
  model       TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, provider_id)
);
CREATE INDEX teacher_keys_user ON teacher_keys(user_id, sort_order);
