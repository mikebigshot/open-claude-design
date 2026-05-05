// POST /api/projects/:projectId/grep  — full-text substring search across project files.
//
// Scans all text blobs for the project, returns up to MAX_HITS matches.
// Uses D1 JOIN to get sha256 + mime_type without N+1 blobs queries for filtering.

import { Hono } from 'hono';
import { FileGrepRequest } from '@open-design/contracts';
import type { Env } from '../index.js';
import { getBlob } from '../storage/r2.js';

const TEXT_MIME = /^(text\/|application\/(json|javascript|xml|x-yaml))/;
const MAX_HITS = 1000;

export const filesGrepRoute = new Hono<{ Bindings: Env }>();

filesGrepRoute.post('/:projectId/grep', async (c) => {
  const projectId = c.req.param('projectId');

  const parsed = FileGrepRequest.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  }
  const { pattern, include } = parsed.data;

  const rows = await c.env.DB.prepare(
    `SELECT f.path, f.sha256, b.mime_type
     FROM files f
     JOIN blobs b ON b.sha256 = f.sha256
     WHERE f.project_id = ?1
     ORDER BY f.path ASC`,
  )
    .bind(projectId)
    .all<{ path: string; sha256: string; mime_type: string }>();

  const matches: { path: string; line: number; text: string }[] = [];
  let truncated = false;

  outer: for (const row of rows.results ?? []) {
    if (include && !row.path.includes(include)) continue;
    if (!TEXT_MIME.test(row.mime_type)) continue;

    const obj = await getBlob(c.env.BLOBS, projectId, row.sha256);
    if (!obj) continue;

    const text = await obj.text();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(pattern)) {
        matches.push({ path: row.path, line: i + 1, text: lines[i]!.slice(0, 300) });
        if (matches.length >= MAX_HITS) {
          truncated = true;
          break outer;
        }
      }
    }
  }

  return c.json({ ok: true as const, matches, truncated });
});
