ALTER TABLE topics ADD COLUMN classroom_id TEXT REFERENCES classrooms(id) ON DELETE CASCADE;
ALTER TABLE topics ADD COLUMN copied_from TEXT REFERENCES topics(id) ON DELETE SET NULL;
CREATE INDEX topics_classroom ON topics(classroom_id);
