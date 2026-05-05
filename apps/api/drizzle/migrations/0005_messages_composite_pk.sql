-- P2-14: messages PK was on `id` alone, so the same short id (e.g. 'm1') reused
-- across two different projects collided with `UNIQUE constraint failed:
-- messages.id`. This was an issue for e2e tests that don't bother generating
-- UUIDs and for any client that reuses ids per-thread.
--
-- Fix: change PK to composite (project_id, id). Each project owns its own id
-- namespace. Within a project, message id is still unique (so optimistic UI
-- replays / retries with the same id are still rejected).
--
-- SQLite doesn't support ALTER TABLE ... DROP/ADD PRIMARY KEY. Standard recipe:
--   1. CREATE TABLE messages_new with the new PK
--   2. INSERT INTO messages_new SELECT * FROM messages   (preserves data)
--   3. DROP TABLE messages
--   4. ALTER TABLE messages_new RENAME TO messages
--   5. Recreate indexes on the renamed table
--
-- FK ON DELETE CASCADE and the (project_id, position) index are preserved.

PRAGMA foreign_keys = OFF;

CREATE TABLE messages_new (
  id          TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  role        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

INSERT INTO messages_new (id, project_id, position, role, data, created_at)
  SELECT id, project_id, position, role, data, created_at FROM messages;

DROP TABLE messages;

ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_project_position ON messages (project_id, position);

PRAGMA foreign_keys = ON;
