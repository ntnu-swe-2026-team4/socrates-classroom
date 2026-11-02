-- 詰問 · 蘇格拉底對話教室 — SQLite schema
-- 所有 id 都是 text、時間都是 ISO 8601 字串，與 docs/api-contract.md 一致。
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
  avatar_url  TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_role_name ON users(role, name);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

/* ---------------- 教室與成員 ---------------- */
CREATE TABLE IF NOT EXISTS classrooms (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  teacher_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS classrooms_teacher ON classrooms(teacher_id);

CREATE TABLE IF NOT EXISTS classroom_members (
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('student', 'assistant')),
  status       TEXT NOT NULL CHECK (status IN ('active', 'invited')) DEFAULT 'active',
  created_at   TEXT NOT NULL,
  PRIMARY KEY (classroom_id, user_id)
);
CREATE INDEX IF NOT EXISTS classroom_members_user ON classroom_members(user_id);

CREATE TABLE IF NOT EXISTS join_policies (
  classroom_id     TEXT PRIMARY KEY REFERENCES classrooms(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  code_enabled     INTEGER NOT NULL DEFAULT 1,
  discoverable     INTEGER NOT NULL DEFAULT 0,
  require_approval INTEGER NOT NULL DEFAULT 0,
  questionnaire    TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS join_policies_code ON join_policies(code);

CREATE TABLE IF NOT EXISTS join_applications (
  id           TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers      TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at   TEXT NOT NULL,
  reviewed_at  TEXT,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS join_applications_classroom ON join_applications(classroom_id, status);
CREATE INDEX IF NOT EXISTS join_applications_student ON join_applications(student_id);

/* ---------------- 議題存檔（單人對話） ---------------- */
CREATE TABLE IF NOT EXISTS archives (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,
  rounds      INTEGER NOT NULL DEFAULT 0,
  snippet     TEXT NOT NULL DEFAULT '',
  bank        TEXT CHECK (bank IS NULL OR bank IN ('private', 'public')),
  in_summary  INTEGER NOT NULL DEFAULT 0,
  activity_id TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS archives_owner ON archives(owner_id);
CREATE INDEX IF NOT EXISTS archives_bank ON archives(bank);

CREATE TABLE IF NOT EXISTS archive_shares (
  archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (archive_id, user_id)
);

CREATE TABLE IF NOT EXISTS archive_messages (
  id         TEXT PRIMARY KEY,
  archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text       TEXT NOT NULL,
  emotion    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS archive_messages_archive ON archive_messages(archive_id, created_at);

/* ---------------- 辯論活動 ---------------- */
CREATE TABLE IF NOT EXISTS activities (
  id             TEXT PRIMARY KEY,
  classroom_id   TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  statement      TEXT NOT NULL,
  answer_mode    TEXT NOT NULL CHECK (answer_mode IN ('text', 'voice', 'both')) DEFAULT 'text',
  axes           TEXT NOT NULL DEFAULT '[]',
  group_size     INTEGER NOT NULL DEFAULT 3,
  stage          TEXT NOT NULL CHECK (stage IN ('individual', 'team', 'debate', 'done')) DEFAULT 'individual',
  stage_deadline TEXT,
  topic_id       TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activities_classroom ON activities(classroom_id);

CREATE TABLE IF NOT EXISTS activity_dialogue (
  id         TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text       TEXT NOT NULL,
  emotion    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_dialogue_owner ON activity_dialogue(activity_id, student_id, created_at);

CREATE TABLE IF NOT EXISTS positions (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim       TEXT NOT NULL DEFAULT '',
  reason      TEXT NOT NULL DEFAULT '',
  evidence    TEXT NOT NULL DEFAULT '',
  coords      TEXT NOT NULL DEFAULT '[]',
  confirmed   INTEGER NOT NULL DEFAULT 0,
  ai_suggested INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (activity_id, student_id)
);

CREATE TABLE IF NOT EXISTS activity_ready (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ready       INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (activity_id, student_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id                TEXT PRIMARY KEY,
  activity_id       TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage             TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('highlight', 'thought')),
  source_message_id TEXT,
  text              TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_owner ON notes(activity_id, student_id);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  member_ids  TEXT NOT NULL DEFAULT '[]',
  centroid    TEXT NOT NULL DEFAULT '[]',
  formed_by   TEXT NOT NULL CHECK (formed_by IN ('auto', 'split')) DEFAULT 'auto',
  seq         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS groups_activity ON groups(activity_id);

CREATE TABLE IF NOT EXISTS group_messages (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('chat', 'system', 'ai_summary', 'ai_counterexample')),
  author_id  TEXT,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS group_messages_group ON group_messages(group_id, created_at);

CREATE TABLE IF NOT EXISTS group_arguments (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('claim', 'reason', 'evidence')),
  text       TEXT NOT NULL,
  parent_id  TEXT,
  axis_index INTEGER NOT NULL DEFAULT 0,
  sign       INTEGER NOT NULL DEFAULT 1,
  status     TEXT NOT NULL CHECK (status IN ('active', 'revised', 'dropped', 'contested')) DEFAULT 'active',
  votes      TEXT NOT NULL DEFAULT '{}',
  countered  INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS group_arguments_group ON group_arguments(group_id, seq);

CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  group_a     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  group_b     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'finished')) DEFAULT 'scheduled',
  phase_idx   INTEGER NOT NULL DEFAULT 0,
  turn_idx    INTEGER NOT NULL DEFAULT 0,
  side_count  TEXT NOT NULL DEFAULT '{"a":0,"b":0}',
  asked       TEXT NOT NULL DEFAULT '{}',
  deadline    TEXT,
  seq         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rooms_activity ON rooms(activity_id, seq);

CREATE TABLE IF NOT EXISTS turns (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  side       TEXT NOT NULL CHECK (side IN ('a', 'b', 'moderator')),
  member_id  TEXT,
  phase      TEXT,
  role       TEXT,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_room ON turns(room_id, seq);

CREATE TABLE IF NOT EXISTS judgments (
  id            TEXT PRIMARY KEY,
  turn_id       TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  side          TEXT NOT NULL CHECK (side IN ('a', 'b')),
  member_id     TEXT NOT NULL,
  phase         TEXT NOT NULL,
  scores        TEXT NOT NULL DEFAULT '{}',
  notes         TEXT NOT NULL DEFAULT '{}',
  verifiability TEXT NOT NULL DEFAULT 'unverified',
  teacher_score REAL
);
CREATE INDEX IF NOT EXISTS judgments_room ON judgments(room_id);

CREATE TABLE IF NOT EXISTS scores (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  individual  REAL NOT NULL DEFAULT 0,
  team        REAL NOT NULL DEFAULT 0,
  debate      REAL NOT NULL DEFAULT 0,
  adjust      REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (activity_id, member_id)
);

/* ---------------- 教室辯論（API 名稱 topic） ---------------- */
CREATE TABLE IF NOT EXISTS topics (
  id              TEXT PRIMARY KEY,
  classroom_id    TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  due_at          TEXT,
  accepts_reports INTEGER NOT NULL DEFAULT 0,
  activity_id     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS topics_classroom ON topics(classroom_id);

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL,
  scope_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size       INTEGER NOT NULL,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_scope ON files(scope_type, scope_id);

CREATE TABLE IF NOT EXISTS topic_resources (
  id       TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('link', 'file')),
  name     TEXT NOT NULL,
  url      TEXT,
  file_id  TEXT REFERENCES files(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL,
  seq      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS topic_resources_topic ON topic_resources(topic_id, seq);

CREATE TABLE IF NOT EXISTS topic_reports (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  student_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  comment      TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS topic_reports_one_per_student ON topic_reports(topic_id, student_id);

/* ---------------- 公告、討論區 ---------------- */
CREATE TABLE IF NOT EXISTS announcements (
  id           TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  pinned       INTEGER NOT NULL DEFAULT 0,
  publish_at   TEXT NOT NULL,
  author_id    TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS announcements_classroom ON announcements(classroom_id, publish_at);

CREATE TABLE IF NOT EXISTS posts (
  id           TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  topic_id     TEXT REFERENCES topics(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES posts(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  anonymous    INTEGER NOT NULL DEFAULT 0,
  author_role  TEXT NOT NULL CHECK (author_role IN ('student', 'teacher')),
  deleted      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_classroom ON posts(classroom_id, topic_id, created_at);

/* ---------------- 多人討論 ---------------- */
CREATE TABLE IF NOT EXISTS discussions (
  id              TEXT PRIMARY KEY,
  classroom_id    TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  prompt          TEXT NOT NULL DEFAULT '',
  conclusion_hint TEXT NOT NULL DEFAULT '',
  due_at          TEXT,
  max_rounds      INTEGER NOT NULL DEFAULT 10,
  status          TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS discussions_classroom ON discussions(classroom_id, created_at);

CREATE TABLE IF NOT EXISTS discussion_sessions (
  id             TEXT PRIMARY KEY,
  discussion_id  TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  student_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conclusion     TEXT,
  submitted_at   TEXT,
  last_active_at TEXT,
  UNIQUE (discussion_id, student_id)
);
CREATE INDEX IF NOT EXISTS discussion_sessions_task ON discussion_sessions(discussion_id);

CREATE TABLE IF NOT EXISTS discussion_messages (
  id          TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text        TEXT NOT NULL,
  emotion     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS discussion_messages_owner ON discussion_messages(discussion_id, student_id, created_at);

/* ---------------- 行事曆 ---------------- */
CREATE TABLE IF NOT EXISTS calendar_events (
  id           TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  at           TEXT NOT NULL,
  note         TEXT,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_events_classroom ON calendar_events(classroom_id, at);
