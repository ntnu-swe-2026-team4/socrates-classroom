CREATE TABLE announcements (
  id           TEXT NOT NULL,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  author_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX announcements_classroom ON announcements(classroom_id, created_at DESC);

CREATE TABLE posts (
  id           TEXT NOT NULL,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  author_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id    TEXT REFERENCES posts(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (id)
);
CREATE INDEX posts_classroom ON posts(classroom_id, created_at);
