CREATE TABLE classroom_announcements (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX classroom_announcements_page ON classroom_announcements(classroom_id, created_at, id);

CREATE TABLE classroom_posts (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (classroom_id, id),
  FOREIGN KEY (classroom_id, parent_id) REFERENCES classroom_posts(classroom_id, id) ON DELETE CASCADE
);

CREATE INDEX classroom_posts_page ON classroom_posts(classroom_id, parent_id, created_at, id);

CREATE TABLE classroom_content_requests (
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  request_key TEXT NOT NULL,
  content_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  PRIMARY KEY (classroom_id, user_id, operation, request_key)
);

CREATE UNIQUE INDEX activities_classroom_activity ON activities(classroom_id, id);
CREATE INDEX activities_classroom_page ON activities(classroom_id, created_at, id);
CREATE INDEX members_classroom_page ON members(classroom_id, joined_at, user_id);
CREATE INDEX activity_participants_personal ON activity_participants(user_id, activity_id) WHERE user_id IS NOT NULL;

CREATE TABLE classroom_invites (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  activity_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('classroom', 'activity_guest', 'classroom_activity')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK ((scope = 'classroom') = (activity_id IS NULL)),
  FOREIGN KEY (classroom_id, activity_id) REFERENCES activities(classroom_id, id) ON DELETE CASCADE
);

CREATE INDEX classroom_invites_page ON classroom_invites(classroom_id, created_at, id);
