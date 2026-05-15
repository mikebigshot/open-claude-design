// D1 查询 helpers。当前用原生 prepared statements；如果未来引入 drizzle-orm，
// 可以替换实现但保持函数签名。
//
// 行类型见 ../../drizzle/schema.ts。
//
// 设计原则：
// - 所有读返回纯 row 对象（snake_case 列名 → 应用层负责映射成 camelCase contract 类型）
// - 所有写返回受影响行数 / 新插入的 row（用 RETURNING）
// - 不在 helper 里做事务编排，调用方按需用 db.batch()

import type {
  AssetRegistration,
  Chat,
  Comment,
  CreateProjectRequest,
  Fidelity,
  Project,
  ProjectType,
  RegisteredAsset,
} from '@open-design/contracts';
import type {
  AssetRow,
  BlobRow,
  ChatRow,
  CommentRow,
  FileRow,
  MessageRow,
  ProjectRow,
} from '../../drizzle/schema.js';

// ============================================================================
// projects
// ============================================================================

/** ListProjects（按 updated_at 倒序）。 */
export async function listProjects(db: D1Database, limit = 20, offset = 0): Promise<Project[]> {
  const result = await db
    .prepare(
      `SELECT id, name, type, fidelity, design_system_id, created_at, updated_at
       FROM projects
       ORDER BY updated_at DESC
       LIMIT ?1 OFFSET ?2`,
    )
    .bind(limit, offset)
    .all<ProjectRow>();
  return (result.results ?? []).map(rowToProject);
}

/** GetProject —— 不存在返回 null。 */
export async function getProject(db: D1Database, id: string): Promise<Project | null> {
  const row = await db
    .prepare(
      `SELECT id, name, type, fidelity, design_system_id, created_at, updated_at
       FROM projects WHERE id = ?1`,
    )
    .bind(id)
    .first<ProjectRow>();
  return row ? rowToProject(row) : null;
}

/** CreateProject —— 返回新建的 project。 */
export async function createProject(db: D1Database, input: CreateProjectRequest): Promise<Project> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO projects (id, name, type, fidelity, design_system_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    )
    .bind(id, input.name, input.type, input.fidelity, input.designSystemId ?? null, now)
    .run();
  return {
    id,
    name: input.name,
    type: input.type,
    fidelity: input.fidelity,
    designSystemId: input.designSystemId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** UpdateProject —— 返回更新后的 project；不存在返回 null。 */
export async function updateProject(
  db: D1Database,
  id: string,
  patch: { name?: string },
): Promise<Project | null> {
  if (patch.name === undefined) {
    return getProject(db, id);
  }
  const now = new Date().toISOString();
  const result = await db
    .prepare(`UPDATE projects SET name = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, patch.name, now)
    .run();
  if (result.meta.changes === 0) return null;
  return getProject(db, id);
}

/** DeleteProject —— hard delete；返回是否删了一行。 */
export async function deleteProject(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM projects WHERE id = ?1`).bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

/** 标记 project 的 updated_at（任何写文件操作都该触底更新）。 */
export async function touchProject(db: D1Database, id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE projects SET updated_at = ?2 WHERE id = ?1`).bind(id, now).run();
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProjectType,
    fidelity: row.fidelity as Fidelity,
    designSystemId: row.design_system_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// blobs
// ============================================================================

/** 检查 blob 元数据是否已存在（决定是否需要重写 R2）。 */
export async function getBlobRow(db: D1Database, sha256: string): Promise<BlobRow | null> {
  return db
    .prepare(`SELECT sha256, mime_type, size, created_at FROM blobs WHERE sha256 = ?1`)
    .bind(sha256)
    .first<BlobRow>();
}

/** Upsert blob 元数据（不重写已存在的）。 */
export async function upsertBlobRow(
  db: D1Database,
  sha256: string,
  mimeType: string,
  size: number,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO blobs (sha256, mime_type, size, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (sha256) DO NOTHING`,
    )
    .bind(sha256, mimeType, size, now)
    .run();
}

// ============================================================================
// files
// ============================================================================

/** ListFiles —— project 内全部文件。 */
export async function listFiles(db: D1Database, projectId: string): Promise<FileRow[]> {
  const result = await db
    .prepare(
      `SELECT project_id, path, sha256, version, created_at, updated_at
       FROM files WHERE project_id = ?1 ORDER BY path ASC`,
    )
    .bind(projectId)
    .all<FileRow>();
  return result.results ?? [];
}

/** GetFile —— 单个文件（包含 sha256 指针）。 */
export async function getFileRow(
  db: D1Database,
  projectId: string,
  path: string,
): Promise<(FileRow & BlobRow) | null> {
  return db
    .prepare(
      `SELECT f.project_id, f.path, f.sha256, f.version, f.created_at, f.updated_at,
              b.mime_type, b.size
       FROM files f JOIN blobs b ON b.sha256 = f.sha256
       WHERE f.project_id = ?1 AND f.path = ?2`,
    )
    .bind(projectId, path)
    .first<FileRow & BlobRow>();
}

/** Upsert file 指针。返回新版本号。 */
export async function upsertFileRow(
  db: D1Database,
  projectId: string,
  path: string,
  sha256: string,
): Promise<number> {
  const now = new Date().toISOString();
  // SQLite 不支持 RETURNING 在 ON CONFLICT 后；先查再写。
  const existing = await db
    .prepare(`SELECT version FROM files WHERE project_id = ?1 AND path = ?2`)
    .bind(projectId, path)
    .first<{ version: number }>();
  const newVersion = existing ? existing.version + 1 : 1;
  await db
    .prepare(
      `INSERT INTO files (project_id, path, sha256, version, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (project_id, path)
       DO UPDATE SET sha256 = excluded.sha256,
                     version = excluded.version,
                     updated_at = excluded.updated_at`,
    )
    .bind(projectId, path, sha256, newVersion, now)
    .run();
  return newVersion;
}

// ============================================================================
// chats（多 chat 支持，Task 2）
// ============================================================================

/** ListChats —— 按 updated_at 倒序返回 project 全部 chats。 */
export async function listChats(db: D1Database, projectId: string): Promise<Chat[]> {
  const result = await db
    .prepare(
      `SELECT id, project_id, title, created_at, updated_at
       FROM chats
       WHERE project_id = ?1
       ORDER BY updated_at DESC`,
    )
    .bind(projectId)
    .all<ChatRow>();
  return (result.results ?? []).map(rowToChat);
}

/** GetChat —— 不存在返回 null。 */
export async function getChat(
  db: D1Database,
  projectId: string,
  chatId: string,
): Promise<Chat | null> {
  const row = await db
    .prepare(
      `SELECT id, project_id, title, created_at, updated_at
       FROM chats WHERE project_id = ?1 AND id = ?2`,
    )
    .bind(projectId, chatId)
    .first<ChatRow>();
  return row ? rowToChat(row) : null;
}

/**
 * CreateChat —— id 由客户端生成（optimistic UI）。INSERT OR REPLACE 让
 * 重试 idempotent（同 id 第二次 POST 不会 500，但更新 title）。
 */
export async function insertChat(
  db: D1Database,
  projectId: string,
  input: { id: string; title?: string | null },
): Promise<Chat> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO chats (id, project_id, title, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (project_id, id)
       DO UPDATE SET title = excluded.title,
                     updated_at = excluded.updated_at`,
    )
    .bind(input.id, projectId, input.title ?? null, now)
    .run();
  return {
    id: input.id,
    projectId,
    title: input.title ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/** PatchChat —— 改 title。不存在返回 null。 */
export async function patchChat(
  db: D1Database,
  projectId: string,
  chatId: string,
  patch: { title?: string | null },
): Promise<Chat | null> {
  if (patch.title === undefined) {
    return getChat(db, projectId, chatId);
  }
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE chats SET title = ?3, updated_at = ?4
       WHERE project_id = ?1 AND id = ?2`,
    )
    .bind(projectId, chatId, patch.title, now)
    .run();
  if (result.meta.changes === 0) return null;
  return getChat(db, projectId, chatId);
}

/** DeleteChat —— hard delete；messages 通过 FK CASCADE 一起走。 */
export async function deleteChat(
  db: D1Database,
  projectId: string,
  chatId: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM chats WHERE project_id = ?1 AND id = ?2`)
    .bind(projectId, chatId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Touch chat updated_at（每次 PUT messages 时更新）。 */
export async function touchChat(db: D1Database, projectId: string, chatId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE chats SET updated_at = ?3 WHERE project_id = ?1 AND id = ?2`)
    .bind(projectId, chatId, now)
    .run();
}

function rowToChat(row: ChatRow): Chat {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// messages（chat history，按 chatId 范围内 thread）
// ============================================================================

/**
 * 客户端 PUT 时传一条消息所需的最小信息。`data` 是 Vercel AI SDK UIMessage
 * 整体 JSON.stringify 之前的对象（包含 id / role / parts / metadata），server
 * 抽 id / role 出来当独立列，data 里也保留一份完整副本（GET 时按 data 还原）。
 */
export interface PersistedMessageInput {
  id: string;
  role: string;
  /** UIMessage 整体（任意可 JSON 序列化结构）。 */
  data: unknown;
}

/**
 * ListMessages —— 按 position 升序返回某 chat 的全部消息 data。
 *
 * Task 2 后必填 chatId（每条 chat 自己的 thread）。
 */
export async function listMessages(
  db: D1Database,
  projectId: string,
  chatId: string,
): Promise<unknown[]> {
  const result = await db
    .prepare(
      `SELECT id, project_id, chat_id, position, role, data, created_at
       FROM messages
       WHERE project_id = ?1 AND chat_id = ?2
       ORDER BY position ASC`,
    )
    .bind(projectId, chatId)
    .all<MessageRow>();
  return (result.results ?? []).map((row) => JSON.parse(row.data) as unknown);
}

/**
 * ReplaceMessages —— 整 thread 替换：DELETE 旧的（限定 chatId），按数组顺序写入新的。
 *
 * 用 D1 batch 实现单 round-trip 原子性（D1 batch 内是 implicit transaction）。
 * thread 长度 < 数百时够用：bulk INSERT 一次批写完。
 *
 * Task 2 后只删该 chatId 范围内的旧 message，不影响 project 下其他 chat 的 thread。
 */
export async function replaceMessages(
  db: D1Database,
  projectId: string,
  chatId: string,
  messages: PersistedMessageInput[],
): Promise<number> {
  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db
      .prepare(`DELETE FROM messages WHERE project_id = ?1 AND chat_id = ?2`)
      .bind(projectId, chatId),
  );
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    stmts.push(
      db
        .prepare(
          `INSERT INTO messages (id, project_id, chat_id, position, role, data, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(m.id, projectId, chatId, i, m.role, JSON.stringify(m.data), now),
    );
  }
  await db.batch(stmts);
  return messages.length;
}

// ============================================================================
// comments（评论钉子）
// ============================================================================

export interface CommentInsertInput {
  id: string;
  n: number;
  x: number;
  y: number;
  text: string;
  selector?: string | null;
  filePath?: string | null;
}

/** ListComments —— 按 n 升序返回 project 全部 pins。 */
export async function listComments(db: D1Database, projectId: string): Promise<Comment[]> {
  const result = await db
    .prepare(
      `SELECT id, project_id, n, x, y, text, selector, file_path, created_at
       FROM comments
       WHERE project_id = ?1
       ORDER BY n ASC`,
    )
    .bind(projectId)
    .all<CommentRow>();
  return (result.results ?? []).map(rowToComment);
}

/**
 * InsertComment —— 客户端生成 id；INSERT OR REPLACE 让重试 idempotent。
 * 重复 PUT（网络抖动 / page unload retry）不会产生第二条 row。
 */
export async function insertComment(
  db: D1Database,
  projectId: string,
  input: CommentInsertInput,
): Promise<Comment> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO comments (id, project_id, n, x, y, text, selector, file_path, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (id)
       DO UPDATE SET n = excluded.n,
                     x = excluded.x,
                     y = excluded.y,
                     text = excluded.text,
                     selector = excluded.selector,
                     file_path = excluded.file_path`,
    )
    .bind(
      input.id,
      projectId,
      input.n,
      input.x,
      input.y,
      input.text,
      input.selector ?? null,
      input.filePath ?? null,
      now,
    )
    .run();
  return {
    id: input.id,
    projectId,
    n: input.n,
    x: input.x,
    y: input.y,
    text: input.text,
    selector: input.selector ?? null,
    filePath: input.filePath ?? null,
    createdAt: now,
  };
}

/** DeleteComment —— 按 id 删；返回是否删了一行。 */
export async function deleteComment(
  db: D1Database,
  projectId: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM comments WHERE project_id = ?1 AND id = ?2`)
    .bind(projectId, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    projectId: row.project_id,
    n: row.n,
    x: row.x,
    y: row.y,
    text: row.text,
    selector: row.selector,
    filePath: row.file_path,
    createdAt: row.created_at,
  };
}

// ============================================================================
// assets
// ============================================================================

/**
 * Register one asset. If a row with the same (project_id, asset, path) already
 * exists, **update** it (status resets to 'needs-review' per v2 spec) — keep
 * the same id so the UI can reference it stably.
 */
export async function upsertAsset(
  db: D1Database,
  projectId: string,
  input: AssetRegistration,
): Promise<RegisteredAsset> {
  const now = new Date().toISOString();
  const existing = await db
    .prepare(
      `SELECT id, project_id, asset, path, subtitle, viewport_w, viewport_h, status, group_, created_at, updated_at
       FROM assets WHERE project_id = ?1 AND asset = ?2 AND path = ?3`,
    )
    .bind(projectId, input.asset, input.path)
    .first<AssetRow>();

  const status = input.status ?? 'needs-review';
  const subtitle = input.subtitle ?? null;
  const viewportW = input.viewport?.width ?? null;
  const viewportH = input.viewport?.height ?? null;
  const group = input.group ?? null;

  if (existing) {
    await db
      .prepare(
        `UPDATE assets
         SET subtitle = ?1,
             viewport_w = ?2,
             viewport_h = ?3,
             status = 'needs-review',
             group_ = ?4,
             updated_at = ?5
         WHERE project_id = ?6 AND id = ?7`,
      )
      .bind(subtitle, viewportW, viewportH, group, now, projectId, existing.id)
      .run();
    return rowToAsset({
      ...existing,
      subtitle,
      viewport_w: viewportW,
      viewport_h: viewportH,
      status: 'needs-review',
      group_: group,
      updated_at: now,
    });
  }

  // New row.
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await db
    .prepare(
      `INSERT INTO assets (id, project_id, asset, path, subtitle, viewport_w, viewport_h, status, group_, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
    )
    .bind(
      id,
      projectId,
      input.asset,
      input.path,
      subtitle,
      viewportW,
      viewportH,
      status,
      group,
      now,
    )
    .run();
  return {
    id,
    projectId,
    asset: input.asset,
    path: input.path,
    subtitle,
    viewport: viewportW !== null ? { width: viewportW, height: viewportH ?? undefined } : null,
    status,
    group,
    createdAt: now,
    updatedAt: now,
  };
}

/** ListAssets — by project, ordered by group then asset name. */
export async function listAssets(db: D1Database, projectId: string): Promise<RegisteredAsset[]> {
  const result = await db
    .prepare(
      `SELECT id, project_id, asset, path, subtitle, viewport_w, viewport_h, status, group_, created_at, updated_at
       FROM assets
       WHERE project_id = ?1
       ORDER BY group_ NULLS LAST, asset ASC, created_at ASC`,
    )
    .bind(projectId)
    .all<AssetRow>();
  return (result.results ?? []).map(rowToAsset);
}

function rowToAsset(row: AssetRow): RegisteredAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    asset: row.asset,
    path: row.path,
    subtitle: row.subtitle,
    viewport:
      row.viewport_w !== null
        ? { width: row.viewport_w, height: row.viewport_h ?? undefined }
        : null,
    status: row.status,
    group: row.group_,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
