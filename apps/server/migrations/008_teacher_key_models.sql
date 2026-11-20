CREATE TABLE teacher_key_models (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id     TEXT NOT NULL,
  model           TEXT NOT NULL,
  max_concurrency INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (user_id, provider_id, model),
  FOREIGN KEY (user_id, provider_id) REFERENCES teacher_keys(user_id, provider_id) ON DELETE CASCADE
);
CREATE INDEX teacher_key_models_user ON teacher_key_models(user_id, sort_order);

INSERT INTO teacher_key_models (user_id, provider_id, model, max_concurrency, sort_order, updated_at)
SELECT user_id, provider_id, model, NULL, 0, updated_at FROM teacher_keys WHERE model != '';

ALTER TABLE teacher_keys DROP COLUMN model;
ALTER TABLE teacher_keys ADD COLUMN max_concurrency INTEGER;
