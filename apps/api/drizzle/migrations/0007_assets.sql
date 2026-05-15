-- Task: register_assets — assets manifest table.
--
-- Each row records a (project_id, asset, path) triple. Re-registering the
-- same (asset, path) pair RESETS the row's status to 'needs-review' (per
-- v2 official spec — register_assets re-registration semantics).
--
-- Columns:
--   id           — application-generated short id (random hex)
--   project_id   — FK -> projects.id (CASCADE)
--   asset        — asset name (the user-facing label, e.g. "Hero", "Primary Color")
--   path         — file path relative to project root
--   subtitle     — optional short description
--   viewport_w   — design width in px (optional)
--   viewport_h   — design height cap (optional)
--   status       — review state: needs-review | approved | changes-requested
--   group_       — section the card belongs to (Type / Colors / Spacing / Components / Brand)
--                  Trailing underscore avoids the reserved keyword `group`.
--   created_at   — ISO8601
--   updated_at   — ISO8601
--
-- Unique constraint on (project_id, asset, path) ensures re-registering the
-- same triple updates the existing row.

CREATE TABLE IF NOT EXISTS assets (
  id          TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  asset       TEXT NOT NULL,
  path        TEXT NOT NULL,
  subtitle    TEXT,
  viewport_w  INTEGER,
  viewport_h  INTEGER,
  status      TEXT NOT NULL DEFAULT 'needs-review' CHECK (status IN ('needs-review','approved','changes-requested')),
  group_      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assets_project_asset_path ON assets (project_id, asset, path);
CREATE INDEX IF NOT EXISTS idx_assets_project_group ON assets (project_id, group_);
