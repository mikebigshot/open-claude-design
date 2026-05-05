import { env } from 'cloudflare:test';
import type { Env } from '../../src/index.js';

// SQL inlined at write time to avoid readFileSync (not available in Workers runtime).
// Source: apps/api/drizzle/migrations/0001_init.sql + 0002_messages.sql + 0003_comments.sql
// + 0004_comments_file_path.sql + 0005_messages_composite_pk.sql + 0006_chats.sql
// (composite PK + chat_id folded directly into the messages CREATE TABLE since
// this DDL only runs on a fresh in-memory D1 — no live recreate dance needed in
// tests).
// If a migration file is added or changed, append/sync the equivalent DDL here.
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('prototype','slide_deck','design_system','other')),
  fidelity        TEXT NOT NULL CHECK (fidelity IN ('wireframe','high')),
  design_system_id TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);

CREATE TABLE IF NOT EXISTS blobs (
  sha256      TEXT PRIMARY KEY NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  project_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, path),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (sha256) REFERENCES blobs (sha256)
);

CREATE INDEX IF NOT EXISTS idx_files_project ON files (project_id);

CREATE TABLE IF NOT EXISTS shares (
  token       TEXT PRIMARY KEY NOT NULL,
  project_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shares_project ON shares (project_id);

CREATE TABLE IF NOT EXISTS chats (
  id          TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  title       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chats_project_updated ON chats (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  position    INTEGER NOT NULL,
  role        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, chat_id) REFERENCES chats (project_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_project_position ON messages (project_id, position);
CREATE INDEX IF NOT EXISTS idx_messages_chat_position ON messages (project_id, chat_id, position);

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY NOT NULL,
  project_id  TEXT NOT NULL,
  n           INTEGER NOT NULL,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  text        TEXT NOT NULL,
  selector    TEXT,
  file_path   TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_project ON comments (project_id, n)
`;

let migrated = false;

/**
 * Apply the SQL migration once per test process.
 * vitest-pool-workers shares one miniflare with `singleWorker: true` AND
 * `isolatedStorage: false` (set in vitest.config.integration.ts), so D1 state
 * persists across both tests within a file and across test files. Therefore
 * applying the schema once per process is sufficient.
 *
 * NOTE: readFileSync is not available in the Workers runtime, so the SQL is
 * inlined above rather than read from disk.
 */
export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  for (const stmt of INIT_SQL.split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    await env.DB.prepare(stmt).run();
  }
  migrated = true;
}

export function testEnv(): Env {
  return env as unknown as Env;
}
