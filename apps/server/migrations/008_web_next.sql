ALTER TABLE users ADD COLUMN preview_classroom_id TEXT REFERENCES classrooms(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX users_preview_classroom ON users(preview_classroom_id) WHERE preview_classroom_id IS NOT NULL;

ALTER TABLE users DROP COLUMN role;

CREATE TABLE solo_chats (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX solo_chats_owner ON solo_chats(user_id, updated_at);

ALTER TABLE topics ADD COLUMN i18n TEXT;
UPDATE topics SET i18n = '{"en":{"title":"The trolley problem: would you pull the lever?","statement":"A runaway trolley is about to hit five people. You can pull a lever to send it onto another track, where it will kill one person. Do you pull it?","prompts":["What is your gut answer — pull or not? Why?","What if that one person were your family?","What if the five were criminals?"]},"es":{"title":"El dilema del tranvía: ¿tirarías de la palanca?","statement":"Un tranvía sin control está a punto de atropellar a cinco personas. Puedes tirar de una palanca para desviarlo a otra vía, donde matará a una persona. ¿Tiras de ella?","prompts":["¿Cuál es tu intuición: tirar o no? ¿Por qué?","¿Y si esa persona fuera de tu familia?","¿Y si los cinco fueran criminales?"]}}' WHERE owner_id IS NULL AND title = '電車難題：你會拉桿嗎？';
UPDATE topics SET i18n = '{"en":{"title":"The surrogate’s promise","statement":"A surrogate mother agreed by contract to give up the child, but after giving birth she wants to keep him. Should the contract be honored?","prompts":["What makes a contract valid in the first place?","Can a body be the object of a contract?","Whose interests does the child’s welfare belong to?"]},"es":{"title":"La promesa de la madre subrogada","statement":"Una madre subrogada aceptó por contrato renunciar al bebé, pero tras el parto quiere quedárselo. ¿Debe cumplirse el contrato?","prompts":["¿Qué hace válido un contrato?","¿Puede el cuerpo ser objeto de un contrato?","¿A quién le corresponde el bienestar del niño?"]}}' WHERE owner_id IS NULL AND title = '代理孕母的承諾';
UPDATE topics SET i18n = '{"en":{"title":"Should AI have rights?","statement":"If an AI showed suffering indistinguishable from a human’s, would we owe it moral consideration?","prompts":["Where do rights come from?","Is showing pain the same as having pain?","Does your judgment rest on consequences or on principles?"]},"es":{"title":"¿Debería la IA tener derechos?","statement":"Si una IA mostrara un sufrimiento indistinguible del humano, ¿le deberíamos consideración moral?","prompts":["¿De dónde vienen los derechos?","¿Mostrar dolor es lo mismo que sentirlo?","¿Tu juicio se basa en consecuencias o en principios?"]}}' WHERE owner_id IS NULL AND title = 'AI 應該有權利嗎？';

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

CREATE TABLE teacher_key_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  key_enc     TEXT NOT NULL,
  last4       TEXT NOT NULL,
  model       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);
CREATE INDEX teacher_key_entries_user ON teacher_key_entries(user_id, sort_order);

INSERT INTO teacher_key_entries (id, user_id, provider_id, key_enc, last4, model, sort_order, updated_at)
SELECT 'k_' || lower(hex(randomblob(16))), user_id, provider_id, key_enc, last4, model, sort_order, updated_at
FROM teacher_keys;

DROP TABLE teacher_keys;

CREATE TABLE schools (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN teacher_plan TEXT CHECK (teacher_plan IN ('trial', 'school'));
ALTER TABLE users ADD COLUMN school_id TEXT REFERENCES schools(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN teacher_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN teacher_terms_at TEXT;
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN student_classroom_id TEXT REFERENCES classrooms(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX users_username ON users(username) WHERE username IS NOT NULL;

UPDATE users SET teacher_plan = 'trial', teacher_terms_at = created_at
  WHERE id IN (SELECT teacher_id FROM classrooms);

UPDATE users SET can_manage_classes = 1 WHERE teacher_plan IS NOT NULL;

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX notifications_created ON notifications(created_at DESC);

ALTER TABLE users ADD COLUMN notifications_seen_at TEXT;

ALTER TABLE users ADD COLUMN teacher_request_at TEXT;
CREATE INDEX users_teacher_request ON users(teacher_request_at) WHERE teacher_request_at IS NOT NULL;

ALTER TABLE users ADD COLUMN usage_quota_tokens INTEGER;

CREATE TABLE usage_months (
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  tokens     INTEGER NOT NULL DEFAULT 0,
  requests   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, month)
);

CREATE TABLE usage_alerts (
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  threshold  INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  emailed_at TEXT,
  PRIMARY KEY (owner_id, month, threshold)
);
CREATE INDEX usage_alerts_pending ON usage_alerts(emailed_at, month);

CREATE INDEX users_student_classroom ON users(student_classroom_id) WHERE student_classroom_id IS NOT NULL;

CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT
);
CREATE INDEX audit_log_target ON audit_log(target_id, created_at);
