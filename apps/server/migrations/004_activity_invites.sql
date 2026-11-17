CREATE TABLE activity_invites (
  token       TEXT NOT NULL PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  revoked_at  TEXT
);
CREATE INDEX activity_invites_activity ON activity_invites(activity_id);
