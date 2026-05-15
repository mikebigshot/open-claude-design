// /api/projects/:id/assets — register_assets manifest persistence.
//
//   POST  /api/projects/:id/assets   RegisterAssets (body: { items })
//   GET   /api/projects/:id/assets   ListAssets
//
// Re-registering the same (asset, path) updates the existing row and resets
// status to 'needs-review' (per v2 official spec). Each row id is stable.

import type {
  AssetRegistration,
  ListAssetsResponse,
  RegisterAssetsRequest,
  RegisterAssetsResponse,
  RegisteredAsset,
} from '@open-design/contracts';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import { getProject, listAssets, touchProject, upsertAsset } from '../storage/d1.js';

export const assetsRoute = new Hono<{ Bindings: Env }>();

function isValidItem(it: unknown): it is AssetRegistration {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  if (typeof o.asset !== 'string' || o.asset === '') return false;
  if (typeof o.path !== 'string' || o.path === '') return false;
  if (
    o.status !== undefined &&
    o.status !== 'needs-review' &&
    o.status !== 'approved' &&
    o.status !== 'changes-requested'
  )
    return false;
  if (o.viewport !== undefined) {
    const v = o.viewport as Record<string, unknown>;
    if (!v || typeof v.width !== 'number') return false;
    if (v.height !== undefined && typeof v.height !== 'number') return false;
  }
  return true;
}

assetsRoute.post('/:id/assets', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as RegisterAssetsRequest | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ code: 'invalid_request', message: 'items must be a non-empty array' }, 400);
  }
  if (!body.items.every(isValidItem)) {
    return c.json({ code: 'invalid_request', message: 'each item needs asset + path' }, 400);
  }
  const registered: RegisteredAsset[] = [];
  for (const it of body.items) {
    registered.push(await upsertAsset(c.env.DB, projectId, it));
  }
  await touchProject(c.env.DB, projectId);
  return c.json({ registered } satisfies RegisterAssetsResponse, 201);
});

assetsRoute.get('/:id/assets', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  const assets = await listAssets(c.env.DB, projectId);
  return c.json({ assets } satisfies ListAssetsResponse);
});

/**
 * DELETE /api/projects/:id/assets — unregister assets from the manifest.
 * Body: `{names: string[]}` — by asset name (matches the value the agent
 * registered). Returns `{ok, deleted: N}` with the row count removed.
 */
assetsRoute.delete('/:id/assets', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as { names?: unknown } | null;
  const names = Array.isArray(body?.names)
    ? body!.names.filter((n): n is string => typeof n === 'string' && n.length > 0)
    : [];
  if (names.length === 0) {
    return c.json({ code: 'invalid_request', message: 'names must be non-empty string array' }, 400);
  }
  // D1 IN clause via placeholders. The schema column is `asset` (the
  // user-facing asset name), not `name`.
  const placeholders = names.map((_, i) => `?${i + 2}`).join(',');
  const result = await c.env.DB.prepare(
    `DELETE FROM assets WHERE project_id = ?1 AND asset IN (${placeholders})`,
  )
    .bind(projectId, ...names)
    .run();
  const deleted = result.meta?.changes ?? 0;
  if (deleted > 0) await touchProject(c.env.DB, projectId);
  return c.json({ ok: true as const, deleted });
});
