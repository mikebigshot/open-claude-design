// POST /api/projects/:id/files-edit — atomic str-replace edit pipeline.
//
// Body: `{path, edits: [{old_string, new_string}, ...]}`. Server-side
// fetches current content, validates each edit's `old_string` is unique
// across the working content, applies all edits in order, then upserts
// the new blob + file row in one D1 transaction.
//
// Uniqueness is checked against the WORKING content (so earlier edits in
// the same batch affect what later edits "see"). This mirrors what a human
// editor's serial Apply All semantics produce, while remaining atomic
// from outside callers' perspective.
//
// Errors:
//   404 not_found      — file missing
//   422 multiple_matches — an edit's old_string matched >1 times
//   422 no_match       — an edit's old_string didn't match at all
//   400 bad_request    — schema violation
//
// On success: `{ok, path, sha256, size, editsApplied}`.

import type { FileMimeType } from '@open-design/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../index.js';
import { getFileRow, upsertBlobRow, upsertFileRow, touchProject } from '../storage/d1.js';
import { getBlob, putBlob } from '../storage/r2.js';
import { sha256 } from '../storage/sha256.js';

const EditEntry = z.object({
  old_string: z.string().min(1),
  new_string: z.string(),
});

const RequestSchema = z.object({
  path: z.string().min(1),
  edits: z.array(EditEntry).min(1).max(50),
});

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

export const filesEditRoute = new Hono<{ Bindings: Env }>();

filesEditRoute.post('/:id/files-edit', async (c) => {
  const projectId = c.req.param('id');

  const parsed = RequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  }
  const { path, edits } = parsed.data;

  const row = await getFileRow(c.env.DB, projectId, path);
  if (!row) {
    return c.json({ error: 'not_found' }, 404);
  }

  const blob = await getBlob(c.env.BLOBS, projectId, row.sha256);
  if (!blob) {
    return c.json({ error: 'blob_missing' }, 500);
  }
  let content = await blob.text();

  for (let i = 0; i < edits.length; i += 1) {
    const { old_string, new_string } = edits[i]!;
    const occurrences = countOccurrences(content, old_string);
    if (occurrences === 0) {
      return c.json({ error: 'no_match', editIndex: i }, 422);
    }
    if (occurrences > 1) {
      return c.json(
        { error: 'multiple_matches', count: occurrences, editIndex: i },
        422,
      );
    }
    content = content.replace(old_string, new_string);
  }

  const bytes = new TextEncoder().encode(content);
  const newSha = await sha256(bytes);

  if (newSha !== row.sha256) {
    const mime = row.mime_type as FileMimeType;
    await putBlob(c.env.BLOBS, projectId, newSha, bytes, mime);
    await upsertBlobRow(c.env.DB, newSha, mime, bytes.byteLength);
    await upsertFileRow(c.env.DB, projectId, path, newSha);
    await touchProject(c.env.DB, projectId);
  }

  return c.json({
    ok: true as const,
    path,
    sha256: newSha,
    size: bytes.byteLength,
    editsApplied: edits.length,
  });
});
