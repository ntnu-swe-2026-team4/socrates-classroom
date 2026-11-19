-- Settings an admin changes after deploy (PUT /api/admin/settings). A key with no row falls back to providers.config.yaml.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Who set the class report's axes when the activity started (#159: teacher | ai). Its report follows this even if the
-- setting changes later. NULL for activities started before this column: they follow the current setting.
ALTER TABLE activities ADD COLUMN report_axes TEXT;
