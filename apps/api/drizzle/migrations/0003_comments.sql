-- comments：评论钉子（Comment 工具产物）。
--
-- id 由客户端 crypto.randomUUID() 生成，optimistic UI 写一致。
-- (x, y) 是预览 viewport 内像素坐标；n 是 1-based 显示序号（删除后可不连续）。
-- selector 可选——记录被评论的元素 CSS selector，用于回放时高亮。

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY NOT NULL,
  project_id  TEXT NOT NULL,
  n           INTEGER NOT NULL,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  text        TEXT NOT NULL,
  selector    TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_project ON comments (project_id, n);
