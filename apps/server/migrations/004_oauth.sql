CREATE TABLE oauth_identities (
  provider   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX oauth_identities_user ON oauth_identities(user_id);
