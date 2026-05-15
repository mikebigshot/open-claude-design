// /api/templates — project template snapshots.
//
// POST /api/projects/:id/save-as-template  {name, description?, intro_text?}
//   Snapshots every file row from the source project into the templates +
//   template_files tables. Reuses sha256 (no R2 traffic). Returns the new
//   template id + file count.
//
//   `intro_text` is the composer intro surfaced to users when they create a
//   new project from this template (mirrors claude.ai/design bundle Bu8zJzmd
//   save_as_template schema's third optional field).
//
// GET /api/templates                         List all templates (name + meta).
// GET /api/templates/:id                     Detail with file list.

import { Hono } from 'hono';
import type { Env } from '../index.js';
import { listFiles as listFilesRows } from '../storage/d1.js';

export const templatesRoute = new Hono<{ Bindings: Env }>();

function newId(): string {
  // 16 random hex chars — good enough for D1 template ids.
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

templatesRoute.post('/projects/:id/save-as-template', async (c) => {
  const projectId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    intro_text?: unknown;
  };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: 'name is required' }, 400);
  const description =
    typeof body.description === 'string' ? body.description.trim() : null;
  const introText =
    typeof body.intro_text === 'string' ? body.intro_text.trim() : null;

  const rows = await listFilesRows(c.env.DB, projectId);
  if (rows.length === 0) {
    return c.json({ error: 'project has no files to snapshot' }, 400);
  }

  const id = newId();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO templates (id, name, description, intro_text, source_project_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
  )
    .bind(id, name, description, introText, projectId, now)
    .run();

  // Insert file rows in batches (D1 doesn't allow >100 bound params per
  // statement; group sha256+path tuples).
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    const placeholders = batch.map((_, j) => `(?${j * 3 + 1}, ?${j * 3 + 2}, ?${j * 3 + 3})`).join(',');
    const binds: unknown[] = [];
    for (const r of batch) binds.push(id, r.path, r.sha256);
    await c.env.DB.prepare(`INSERT INTO template_files (template_id, path, sha256) VALUES ${placeholders}`)
      .bind(...binds)
      .run();
  }

  return c.json({ ok: true as const, templateId: id, fileCount: rows.length });
});

templatesRoute.get('/templates', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.description, t.intro_text, t.source_project_id, t.created_at,
            COUNT(tf.path) AS file_count
     FROM templates t
     LEFT JOIN template_files tf ON tf.template_id = t.id
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
  ).all<{
    id: string;
    name: string;
    description: string | null;
    intro_text: string | null;
    source_project_id: string | null;
    created_at: string;
    file_count: number;
  }>();
  return c.json({
    templates: (result.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      introText: r.intro_text,
      sourceProjectId: r.source_project_id,
      createdAt: r.created_at,
      fileCount: r.file_count,
    })),
  });
});

templatesRoute.get('/templates/:id', async (c) => {
  const id = c.req.param('id');
  const tpl = await c.env.DB.prepare('SELECT * FROM templates WHERE id = ?1')
    .bind(id)
    .first<{
      id: string;
      name: string;
      description: string | null;
      intro_text: string | null;
      source_project_id: string | null;
      created_at: string;
      updated_at: string;
    }>();
  if (!tpl) return c.json({ error: 'not_found' }, 404);
  const files = await c.env.DB.prepare(
    'SELECT path, sha256 FROM template_files WHERE template_id = ?1 ORDER BY path',
  )
    .bind(id)
    .all<{ path: string; sha256: string }>();
  return c.json({
    template: {
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      introText: tpl.intro_text,
      sourceProjectId: tpl.source_project_id,
      createdAt: tpl.created_at,
      updatedAt: tpl.updated_at,
      files: files.results ?? [],
    },
  });
});
