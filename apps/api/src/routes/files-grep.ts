// POST /api/projects/:projectId/grep — regex search across project text files.
//
// Aligned with official Claude Design `grep` tool:
//   - pattern is a JS regex (no flags in the literal — case-insensitive
//     enforced by the route)
//   - `path` (optional): dir prefix or single file path. Limits scan scope.
//   - up to MAX_HITS=100 matches; truncates and sets truncated:true on cap
//   - each match includes ±CONTEXT=2 lines around the matched line
//   - invalid regex pattern → 400 bad_pattern

import { Hono } from 'hono';
import { FileGrepRequest } from '@open-design/contracts';
import type { Env } from '../index.js';
import { getBlob } from '../storage/r2.js';

const TEXT_MIME = /^(text\/|application\/(json|javascript|xml|x-yaml))/;
const MAX_HITS = 100;
const CONTEXT = 2;
const LINE_TEXT_CAP = 300;

function clampLine(s: string): string {
  return s.length > LINE_TEXT_CAP ? s.slice(0, LINE_TEXT_CAP) : s;
}

export const filesGrepRoute = new Hono<{ Bindings: Env }>();

filesGrepRoute.post('/:projectId/grep', async (c) => {
  const projectId = c.req.param('projectId');

  const parsed = FileGrepRequest.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  }
  const { pattern, path: scope } = parsed.data;

  // Compile the regex once. Case-insensitive default per official.
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch (err) {
    return c.json(
      { error: 'bad_pattern', message: err instanceof Error ? err.message : 'invalid regex' },
      400,
    );
  }

  // Scope filter: when `path` is provided, it can be:
  //   - a directory prefix (we accept exact match or prefix + "/")
  //   - a single file path (exact match)
  // Mirrors official "a directory path searches everything under it; a file
  // path searches just that file".
  function inScope(p: string): boolean {
    if (!scope) return true;
    if (p === scope) return true;
    const prefix = scope.endsWith('/') ? scope : scope + '/';
    return p.startsWith(prefix);
  }

  const rows = await c.env.DB.prepare(
    `SELECT f.path, f.sha256, b.mime_type
     FROM files f
     JOIN blobs b ON b.sha256 = f.sha256
     WHERE f.project_id = ?1
     ORDER BY f.path ASC`,
  )
    .bind(projectId)
    .all<{ path: string; sha256: string; mime_type: string }>();

  const matches: {
    path: string;
    line: number;
    before: string[];
    match: string;
    after: string[];
  }[] = [];
  let truncated = false;

  outer: for (const row of rows.results ?? []) {
    if (!inScope(row.path)) continue;
    if (!TEXT_MIME.test(row.mime_type)) continue;

    const obj = await getBlob(c.env.BLOBS, projectId, row.sha256);
    if (!obj) continue;

    const text = await obj.text();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Reset regex.lastIndex isn't needed because we don't use /g.
      if (!re.test(line)) continue;
      const before: string[] = [];
      for (let j = Math.max(0, i - CONTEXT); j < i; j++) {
        before.push(clampLine(lines[j] ?? ''));
      }
      const after: string[] = [];
      for (let j = i + 1; j < Math.min(lines.length, i + CONTEXT + 1); j++) {
        after.push(clampLine(lines[j] ?? ''));
      }
      matches.push({
        path: row.path,
        line: i + 1,
        before,
        match: clampLine(line),
        after,
      });
      if (matches.length >= MAX_HITS) {
        truncated = true;
        break outer;
      }
    }
  }

  return c.json({ ok: true as const, matches, truncated });
});
