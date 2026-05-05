-- messages：聊天历史。每个 project 一个 thread（KISS，不引 conversations 层）。
--
-- 写入策略：客户端 PUT 整 thread，server 走 batch transaction：
--   DELETE FROM messages WHERE project_id = ?
--   INSERT INTO messages (...) VALUES (...) × N
-- 详见 apps/api/src/storage/d1.ts replaceMessages()。
--
-- data 列存 Vercel AI SDK 的 UIMessage JSON.stringify（含 id / role / parts /
-- metadata），保留 tool calls / reasoning / 文本等所有结构无信息丢失。
-- id / role / position 抽出来当独立列，便于将来加按 role / 按 position 查询索引。

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY NOT NULL,
  project_id  TEXT NOT NULL,
  position    INTEGER NOT NULL,
  role        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_project_position ON messages (project_id, position);
