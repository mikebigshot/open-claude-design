// POST /api/projects/:projectId/files/copy  ← batch copy within a project (reuses blob refs)
//
// Copies file metadata rows in D1 (project_id, path, sha256) without re-uploading R2 blobs.
// Sources that don't exist are silently skipped.

import { Hono } from 'hono';
import { FileCopyRequest } from '@open-design/contracts';
import type { Env } from '../index.js';
import { getFileRow, upsertFileRow, touchProject } from '../storage/d1.js';

export const filesCopyRoute = new Hono<{ Bindings: Env }>();

filesCopyRoute.post('/:projectId/files/copy', async (c) => {
  const projectId = c.req.param('projectId');

  const parse = FileCopyRequest.safeParse(await c.req.json());
  if (!parse.success) {
    return c.json({ error: 'bad_request', issues: parse.error.issues }, 400);
  }
  const { sources, destDir } = parse.data;
  const db = c.env.DB;

  const copied: { from: string; to: string }[] = [];
  for (const from of sources) {
    const row = await getFileRow(db, projectId, from);
    if (!row) continue;

    const baseName = from.split('/').pop()!;
    const to = destDir.replace(/\/$/, '') + '/' + baseName;

    await upsertFileRow(db, projectId, to, row.sha256);
    copied.push({ from, to });
  }

  if (copied.length > 0) {
    await touchProject(db, projectId);
  }

  return c.json({ ok: true as const, copied });
});
