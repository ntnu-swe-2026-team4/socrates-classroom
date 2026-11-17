CREATE TABLE announcements (
  id           TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX announcements_classroom ON announcements(classroom_id, created_at);

CREATE TABLE posts (
  id           TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES posts(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX posts_classroom ON posts(classroom_id, parent_id, created_at);
