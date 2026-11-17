CREATE TABLE activity_participants (
  activity_id     TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  id              TEXT NOT NULL,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('member', 'guest', 'teacher')),
  display_name    TEXT NOT NULL,
  tos_accepted_at TEXT,
  joined_at       TEXT NOT NULL,
  PRIMARY KEY (activity_id, id)
);
CREATE UNIQUE INDEX activity_participants_name ON activity_participants(activity_id, display_name);
CREATE INDEX activity_participants_user ON activity_participants(activity_id, user_id);

INSERT INTO activity_participants (activity_id, id, user_id, kind, display_name, tos_accepted_at, joined_at)
SELECT a.id, m.user_id, m.user_id, 'member', m.name, m.tos_accepted_at, m.joined_at
FROM activities a
JOIN members m ON m.classroom_id = a.classroom_id;

CREATE TABLE pseudonyms_next (
  activity_id    TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  pseudonym      TEXT NOT NULL,
  PRIMARY KEY (activity_id, participant_id),
  FOREIGN KEY (activity_id, participant_id) REFERENCES activity_participants(activity_id, id) ON DELETE CASCADE
);

INSERT INTO pseudonyms_next (activity_id, participant_id, pseudonym)
SELECT activity_id, student_id, pseudonym FROM pseudonyms;

DROP TABLE pseudonyms;
ALTER TABLE pseudonyms_next RENAME TO pseudonyms;
