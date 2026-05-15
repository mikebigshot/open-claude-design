-- Project templates: snapshots of a project's files that can be used as
-- starting points for new projects (Home page "From template" tab).
--
-- We snapshot the file list (path + sha256) rather than copying R2 blobs:
-- new-project-from-template re-uses the existing blobs by sha256, so
-- creation is O(file count) D1 inserts, no R2 traffic.

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  -- The project this template was snapshotted from (informational only;
  -- the template doesn't keep a live link).
  source_project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_files (
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (template_id, path)
);

CREATE INDEX IF NOT EXISTS idx_templates_created
  ON templates(created_at DESC);
