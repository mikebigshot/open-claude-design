-- Open Design D1 schema (SQLite, Cloudflare D1).
-- 对应 storage-architecture.md §3.1 的 Postgres DDL，简化为 SQLite 子集。
--
-- 主要简化：
-- - `gen_random_uuid()` 由应用层（crypto.randomUUID）生成
-- - `JSONB` 全部换成 TEXT（应用层 JSON.stringify）
-- - 时间戳用 ISO8601 TEXT 而不是 timestamptz（D1 没有原生时间类型）
-- - 不做引用计数 GC（已推迟）：blobs 表只做"是否上传过 R2"的查重索引
--
-- 索引策略：
-- - projects.updated_at 用于 ListProjects ORDER BY desc
-- - files (project_id, path) 是主键
-- - shares.token 是主键（直接查找）

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

-- blobs：sha256 内容寻址查重表。
-- 同一 sha 的内容已经上传过 R2 时，跳过 PUT。
CREATE TABLE IF NOT EXISTS blobs (
  sha256      TEXT PRIMARY KEY NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

-- files：(project_id, path) 是当前指针。每次写入自增 version。
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

-- shares：share-link token，HMAC 签名见 routes/share.ts。
CREATE TABLE IF NOT EXISTS shares (
  token       TEXT PRIMARY KEY NOT NULL,
  project_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shares_project ON shares (project_id);
