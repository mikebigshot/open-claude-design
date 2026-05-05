// /api/projects/:id/files/* —— 项目文件 CRUD：
//   GET  /api/projects/:id/files          ← ListFiles
//   GET  /api/projects/:id/files/{path}   ← GetFile
//   PUT  /api/projects/:id/files/{path}   ← EditFile (= write_file tool)
//
// 写入流程：
//   1. sha256 = sha256(content)
//   2. blob 是否已上传 R2？没有 → put + insert blobs 表
//   3. upsert files 表（version++）
//   4. touch projects.updated_at
//
// 注意：path 段是 wildcard（含 / 的相对路径），用 Hono 的 :filePath{.+} 正则 param。
// 比如 PUT /api/projects/abc/files/src/components/Header.tsx，filePath = "src/components/Header.tsx"。

import type {
  FileMimeType,
  FileRecord,
  FileWriteRequest,
  FileWriteResponse,
  ListFilesResponse,
} from '@open-design/contracts';
import { isAllowedMime } from '@open-design/contracts';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import {
  getBlobRow,
  getFileRow,
  listFiles as listFilesRows,
  touchProject,
  upsertBlobRow,
  upsertFileRow,
} from '../storage/d1.js';
import { getBlob, putBlob } from '../storage/r2.js';
import { sha256 } from '../storage/sha256.js';

export const filesRoute = new Hono<{ Bindings: Env }>();

/** GET /api/projects/:id/files —— 列项目所有文件。 */
filesRoute.get('/:id/files', async (c) => {
  const projectId = c.req.param('id');
  const rows = await listFilesRows(c.env.DB, projectId);
  // 列表返回需要 mime / size，要 join blobs 表。listFilesRows 没 join，重新查一次。
  const files: FileRecord[] = [];
  for (const row of rows) {
    const blob = await getBlobRow(c.env.DB, row.sha256);
    if (!blob) continue;
    files.push({
      projectId: row.project_id,
      path: row.path,
      sha256: row.sha256,
      size: blob.size,
      mimeType: blob.mime_type as FileMimeType,
      updatedAt: row.updated_at,
    });
  }
  return c.json({ files } satisfies ListFilesResponse);
});

/** GET /api/projects/:id/files/{path} —— 读文件 bytes。 */
filesRoute.get('/:id/files/:filePath{.+}', async (c) => {
  const projectId = c.req.param('id');
  const filePath = decodeURIComponent(c.req.param('filePath'));
  const row = await getFileRow(c.env.DB, projectId, filePath);
  if (!row) {
    return c.json({ code: 'not_found', message: 'file not found' }, 404);
  }
  const obj = await getBlob(c.env.BLOBS, projectId, row.sha256);
  if (!obj) {
    return c.json({ code: 'blob_missing', message: 'blob bytes missing in storage' }, 500);
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': row.mime_type,
      'cache-control': 'private, no-cache',
      'x-content-hash': row.sha256,
      etag: `"${row.sha256}"`,
    },
  });
});

/** PUT /api/projects/:id/files/{path} —— 写文件。 */
filesRoute.put('/:id/files/:filePath{.+}', async (c) => {
  const projectId = c.req.param('id');
  const filePath = decodeURIComponent(c.req.param('filePath'));
  const contentType = c.req.header('content-type') ?? '';

  let bytes: Uint8Array;
  let mimeType: FileMimeType;

  if (contentType.startsWith('application/json')) {
    // 文本路径：chat tool（write_file / str_replace）走这条
    const body = await c.req.json<FileWriteRequest>();
    if (typeof body.content !== 'string') {
      return c.json({ code: 'invalid_request', message: 'content must be a string' }, 400);
    }
    // 收紧：客户端给的 mimeType 必须命中 allowlist；split 掉 charset 等参数后再判
    // —— 否则降级到按文件后缀推断。防止 stored-XSS / 破坏 FileMimeType union 契约
    const baseMime = (body.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    mimeType = isAllowedMime(baseMime) ? baseMime : inferMime(filePath);
    bytes = new TextEncoder().encode(body.content);
  } else {
    // Binary 路径：ImportPopover / Composer paste 走这条
    const buf = await c.req.arrayBuffer();
    bytes = new Uint8Array(buf);
    // 收紧：header content-type 必须命中 allowlist；strip charset 后再判。空 / 非法 → 按 path 推
    const baseMime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    mimeType = isAllowedMime(baseMime) ? baseMime : inferMime(filePath);
  }

  const hash = await sha256(bytes);

  const existingBlob = await getBlobRow(c.env.DB, hash);
  if (!existingBlob) {
    await putBlob(c.env.BLOBS, projectId, hash, bytes, mimeType);
    await upsertBlobRow(c.env.DB, hash, mimeType, bytes.byteLength);
  } else {
    await putBlob(c.env.BLOBS, projectId, hash, bytes, mimeType);
  }

  const version = await upsertFileRow(c.env.DB, projectId, filePath, hash);
  await touchProject(c.env.DB, projectId);

  return c.json({
    path: filePath,
    sha256: hash,
    size: bytes.byteLength,
    version,
  } satisfies FileWriteResponse);
});

/** DELETE /api/projects/:id/files/{path} —— 删文件行（不删 R2 blob，留给 GC）。 */
filesRoute.delete('/:id/files/:filePath{.+}', async (c) => {
  const projectId = c.req.param('id');
  const filePath = decodeURIComponent(c.req.param('filePath'));
  const result = await c.env.DB.prepare('DELETE FROM files WHERE project_id = ? AND path = ?')
    .bind(projectId, filePath)
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    return c.json({ ok: false, error: 'not_found' }, 404);
  }
  return c.json({ ok: true });
});

/** 按文件后缀推 MIME；不在白名单里 fallback 为 text/plain。 */
function inferMime(path: string): FileMimeType {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'jsx':
    case 'tsx':
      return 'text/jsx';
    case 'js':
    case 'ts':
    case 'mjs':
      return 'text/javascript';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'json':
      return 'application/json';
    default:
      return 'text/plain';
  }
}
