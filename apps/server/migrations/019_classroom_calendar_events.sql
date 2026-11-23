CREATE TABLE classroom_calendar_events (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  activity_id TEXT UNIQUE REFERENCES activities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX classroom_calendar_events_range ON classroom_calendar_events(classroom_id, starts_at, id);
