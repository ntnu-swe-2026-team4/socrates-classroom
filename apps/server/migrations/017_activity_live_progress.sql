ALTER TABLE activities ADD COLUMN live_projection_legacy INTEGER NOT NULL DEFAULT 0 CHECK (live_projection_legacy IN (0, 1));

UPDATE activities SET live_projection_legacy = 1 WHERE mode = 'live';

CREATE TABLE activity_live_progress (
  activity_id    TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  last_entry_id  INTEGER NOT NULL CHECK (last_entry_id >= 0),
  rounds         INTEGER NOT NULL CHECK (rounds >= 0),
  last_active_at INTEGER,
  flags          TEXT NOT NULL CHECK (json_valid(flags)),
  PRIMARY KEY (activity_id, participant_id),
  FOREIGN KEY (activity_id, participant_id) REFERENCES activity_participants(activity_id, id) ON DELETE CASCADE
);
