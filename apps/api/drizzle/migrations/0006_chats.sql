-- Task 2: 多 Chat 支持 — 加 chats 表 + messages.chat_id 列。
--
-- 数据迁移策略（保护已有数据）：
--   1) CREATE chats 表
--   2) ALTER messages ADD COLUMN chat_id TEXT （nullable 先）
--   3) 给每个有 messages 的 project 创一条 default chat（复用最早一条 message 的 created_at）
--   4) UPDATE messages SET chat_id = <default chat for that project>
--   5) 重建 messages 表（SQLite 不支持 ADD CONSTRAINT），把 chat_id 改 NOT NULL，
--      加 FK + composite PK + 索引
--
-- SQLite 不支持 ALTER ... ADD COLUMN ... NOT NULL DEFAULT subquery，所以走经典
-- create-new + copy + drop + rename 模式。同 0005_messages_composite_pk.sql 风格。
--
-- ON DELETE CASCADE：删 chat 时它的 messages 跟着走；删 project 时 chats +
-- messages 都跟着走。
--
-- 注：0005 已经把 messages PK 改成 (project_id, id)。本次保留这个 PK，仅加 chat_id 列。

PRAGMA foreign_keys = OFF;

-- 1) chats 表
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

-- 2) 给每个有 messages 的 project 建一条 default chat（覆盖现有数据）
--
-- 用 random hex id（不引 application 层 UUID 生成；id 仅供内部使用，UI 不敏感）。
-- 取该 project messages 最早的 created_at 当 chat created_at；最晚的当 updated_at。
INSERT INTO chats (id, project_id, title, created_at, updated_at)
  SELECT
    lower(hex(randomblob(16))) AS id,
    project_id,
    'Chat 1' AS title,
    MIN(created_at) AS created_at,
    MAX(created_at) AS updated_at
  FROM messages
  GROUP BY project_id;

-- 3) 重建 messages 表加 chat_id 列 NOT NULL + FK
CREATE TABLE messages_new (
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

INSERT INTO messages_new (id, project_id, chat_id, position, role, data, created_at)
  SELECT
    m.id,
    m.project_id,
    -- 找该 project 唯一一条 default chat 的 id（步骤 2 每 project 一条）
    (SELECT c.id FROM chats c WHERE c.project_id = m.project_id LIMIT 1) AS chat_id,
    m.position,
    m.role,
    m.data,
    m.created_at
  FROM messages m;

DROP TABLE messages;

ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_project_position ON messages (project_id, position);
CREATE INDEX IF NOT EXISTS idx_messages_chat_position ON messages (project_id, chat_id, position);

PRAGMA foreign_keys = ON;
