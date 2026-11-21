CREATE TABLE user_identities_new (
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email            TEXT,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
INSERT INTO user_identities_new SELECT provider, provider_user_id, user_id, email, created_at FROM user_identities;
DROP TABLE user_identities;
ALTER TABLE user_identities_new RENAME TO user_identities;
CREATE INDEX user_identities_user ON user_identities(user_id);
