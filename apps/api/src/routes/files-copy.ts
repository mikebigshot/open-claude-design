// POST /api/projects/:projectId/files/copy — per-file copy/rename batch.
//
// Body: `{files: [{src, dest, move?, asset?}]}` — per-entry destinations
// (not a shared destDir), per-entry move semantics.
// Returns: `{ok: true, results: [{src, dest, moved}, ...]}`.
//
// `src` may be a relative path within the current project OR a cross-project
// reference of the form `/projects/<sourceProjectId>/<path>`. Cross-project
// reads only succeed when the requesting client already has the source
// project's R2 blob accessible (the worker rejects requests for blobs that
// don't exist).
//
// Reuses sha256 across copies so the underlying R2 blob is not re-uploaded.
// `move: true` removes the src row after copy — only applies to same-project
// copies (cross-project moves are rejected to prevent stealing files).

import { Hono } from 'hono';
import { FileCopyRequest } from '@open-design/contracts';
import type { Env } from '../index.js';
import { getFileRow, upsertFileRow, touchProject } from '../storage/d1.js';
import { blobExists, getBlob, putBlob } from '../storage/r2.js';

export const filesCopyRoute = new Hono<{ Bindings: Env }>();

const CROSS_PROJECT_RE = /^\/projects\/([A-Za-z0-9_-]+)\/(.*)$/;

function resolveSrc(
  defaultProjectId: string,
  src: string,
): { projectId: string; path: string; crossProject: boolean } {
  const m = src.match(CROSS_PROJECT_RE);
  if (m) return { projectId: m[1]!, path: m[2]!, crossProject: true };
  return { projectId: defaultProjectId, path: src, crossProject: false };
}

filesCopyRoute.post('/:projectId/files/copy', async (c) => {
  const projectId = c.req.param('projectId');

  const parse = FileCopyRequest.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'bad_request', issues: parse.error.issues }, 400);
  }
  const { files } = parse.data;
  const db = c.env.DB;

  const results: { src: string; dest: string; moved: boolean }[] = [];
  for (const entry of files) {
    const resolved = resolveSrc(projectId, entry.src);
    // Cross-project moves are refused — moving a file out of someone else's
    // project shouldn't be possible by a same-tab agent loop.
    if (resolved.crossProject && entry.move === true) {
      return c.json(
        {
          error: 'cross_project_move_forbidden',
          message: `Cross-project src "${entry.src}" cannot be moved (only copied).`,
        },
        400,
      );
    }
    const row = await getFileRow(db, resolved.projectId, resolved.path);
    if (!row) {
      // Skip silently — surface in results so the caller sees nothing happened.
      results.push({ src: entry.src, dest: entry.dest, moved: false });
      continue;
    }

    // R2 blobs are namespaced per project. For cross-project copies, copy
    // the bytes into the destination project's namespace so the file can be
    // served by GET /api/projects/<destId>/files/<dest>.
    if (resolved.crossProject) {
      const destHas = await blobExists(c.env.BLOBS, projectId, row.sha256);
      if (!destHas) {
        const obj = await getBlob(c.env.BLOBS, resolved.projectId, row.sha256);
        if (!obj) {
          results.push({ src: entry.src, dest: entry.dest, moved: false });
          continue;
        }
        const buf = new Uint8Array(await obj.arrayBuffer());
        await putBlob(
          c.env.BLOBS,
          projectId,
          row.sha256,
          buf,
          row.mime_type as never,
        );
      }
    }

    await upsertFileRow(db, projectId, entry.dest, row.sha256);

    if (entry.move === true && !resolved.crossProject) {
      await db
        .prepare('DELETE FROM files WHERE project_id = ? AND path = ?')
        .bind(resolved.projectId, resolved.path)
        .run();
    }

    results.push({ src: entry.src, dest: entry.dest, moved: entry.move === true });
  }

  if (results.length > 0) {
    await touchProject(db, projectId);
  }

  return c.json({ ok: true as const, results });
});
