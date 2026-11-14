CREATE TABLE user_identities (
  provider         TEXT NOT NULL CHECK (provider IN ('google')),
  provider_user_id TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX user_identities_user ON user_identities(user_id);
