// Routes under test (apps/api/src/routes/assets.ts):
//   POST  /api/projects/:id/assets   → 201 { registered: RegisteredAsset[] } | 400 / 404
//   GET   /api/projects/:id/assets   → 200 { assets: RegisteredAsset[] } | 404
//
// Re-registering the same (asset, path) MUST reset status to 'needs-review' and
// keep the row's id stable.

import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type {
  ListAssetsResponse,
  Project,
  RegisterAssetsRequest,
  RegisterAssetsResponse,
} from '@open-design/contracts';

const BASE_PROJECT = {
  name: 'Test Assets Project',
  type: 'prototype' as const,
  fidelity: 'wireframe' as const,
};

async function createProject(app: ReturnType<typeof makeTestApp>): Promise<Project> {
  const res = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(BASE_PROJECT),
  });
  return (await res.json()) as Project;
}

async function postAssets(
  app: ReturnType<typeof makeTestApp>,
  projectId: string,
  body: RegisterAssetsRequest,
): Promise<{ status: number; body?: RegisterAssetsResponse }> {
  const res = await app.request(`/api/projects/${projectId}/assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) return { status: res.status };
  return { status: res.status, body: (await res.json()) as RegisterAssetsResponse };
}

describe('routes/assets', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('POST returns 404 for unknown project', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/no-such/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ asset: 'Hero', path: 'hero.png' }] }),
    });
    expect(res.status).toBe(404);
  });

  it('POST returns 400 when items is missing or empty', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const r1 = await postAssets(app, project.id, { items: [] });
    expect(r1.status).toBe(400);

    const r2 = await app.request(`/api/projects/${project.id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r2.status).toBe(400);
  });

  it('POST returns 400 when an item is missing required asset/path', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ asset: 'X' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('POST creates assets and returns them with default status', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const created = await postAssets(app, project.id, {
      items: [
        {
          asset: 'Hero',
          path: 'screens/hero.png',
          subtitle: 'main hero shot',
          group: 'Components',
        },
        { asset: 'Primary Color', path: 'colors/primary.css', group: 'Colors' },
      ],
    });
    expect(created.status).toBe(201);
    const list = created.body!.registered;
    expect(list.length).toBe(2);
    for (const a of list) {
      expect(a.id).toBeTruthy();
      expect(a.projectId).toBe(project.id);
      expect(a.status).toBe('needs-review');
      expect(a.createdAt).toBeTruthy();
    }
    expect(list[0]?.subtitle).toBe('main hero shot');
    expect(list[0]?.group).toBe('Components');
  });

  it('POST persists viewport and explicit status', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const r = await postAssets(app, project.id, {
      items: [
        {
          asset: 'Tablet Landing',
          path: 'screens/tablet.html',
          viewport: { width: 768, height: 1024 },
          status: 'approved',
        },
      ],
    });
    const a = r.body!.registered[0]!;
    expect(a.viewport).toEqual({ width: 768, height: 1024 });
    expect(a.status).toBe('approved');
  });

  it('GET returns the persisted assets', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    await postAssets(app, project.id, {
      items: [
        { asset: 'A', path: 'a.txt' },
        { asset: 'B', path: 'b.txt' },
      ],
    });
    const res = await app.request(`/api/projects/${project.id}/assets`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListAssetsResponse;
    expect(body.assets.length).toBe(2);
    expect(body.assets.map((a) => a.asset).sort()).toEqual(['A', 'B']);
  });

  it('Re-registering same (asset, path) resets status to needs-review and keeps the same id', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const r1 = await postAssets(app, project.id, {
      items: [{ asset: 'Hero', path: 'hero.png', status: 'approved' }],
    });
    const original = r1.body!.registered[0]!;
    expect(original.status).toBe('approved');

    const r2 = await postAssets(app, project.id, {
      items: [{ asset: 'Hero', path: 'hero.png', subtitle: 'updated' }],
    });
    const updated = r2.body!.registered[0]!;
    expect(updated.id).toBe(original.id); // same row
    expect(updated.status).toBe('needs-review'); // reset
    expect(updated.subtitle).toBe('updated');
  });

  it('GET returns 404 for unknown project', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/no-such/assets', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('GET returns empty list for fresh project', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/assets`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListAssetsResponse;
    expect(body.assets).toEqual([]);
  });

  // ── Phase 1 tail: write_file ↔ asset manifest auto-sync ────────────
  it('PUT /files with body.asset auto-registers an asset row', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const putRes = await app.request(
      `/api/projects/${project.id}/files/${encodeURIComponent('deck/index.html')}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: '<html/>',
          asset: 'main-deck',
          subtitle: 'v1',
          viewport: { width: 1440, height: 900 },
        }),
      },
    );
    expect(putRes.status).toBe(200);
    const list = await app.request(`/api/projects/${project.id}/assets`);
    const body = (await list.json()) as ListAssetsResponse;
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0]).toMatchObject({
      asset: 'main-deck',
      path: 'deck/index.html',
      subtitle: 'v1',
    });
    // Viewport survives.
    const vp = (body.assets[0] as { viewport?: { width: number; height?: number } | null })
      .viewport;
    expect(vp?.width).toBe(1440);
    expect(vp?.height).toBe(900);
  });

  // ── Phase 4: unregister_assets via DELETE ──────────────────────────
  it('DELETE /assets {names:[]} removes matching asset rows by asset name', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    // Register two assets.
    await app.request(`/api/projects/${project.id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [
          { asset: 'a', path: 'a.html' },
          { asset: 'b', path: 'b.html' },
        ],
      } satisfies RegisterAssetsRequest),
    });

    const del = await app.request(`/api/projects/${project.id}/assets`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ names: ['a'] }),
    });
    expect(del.status).toBe(200);
    const delBody = (await del.json()) as { ok: boolean; deleted: number };
    expect(delBody.deleted).toBe(1);

    const list = await app.request(`/api/projects/${project.id}/assets`);
    const body = (await list.json()) as ListAssetsResponse;
    expect(body.assets.map((a) => a.asset)).toEqual(['b']);
  });

  // ── Phase 1 tail: delete_file → asset cascade ──────────────────────
  it('POST /files/delete cascades to asset rows pointing at the deleted file', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    await app.request(
      `/api/projects/${project.id}/files/${encodeURIComponent('canvas.html')}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'x', asset: 'canvas-v1' }),
      },
    );
    const before = (await (
      await app.request(`/api/projects/${project.id}/assets`)
    ).json()) as ListAssetsResponse;
    expect(before.assets).toHaveLength(1);

    await app.request(`/api/projects/${project.id}/files/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['canvas.html'] }),
    });
    const after = (await (
      await app.request(`/api/projects/${project.id}/assets`)
    ).json()) as ListAssetsResponse;
    expect(after.assets).toEqual([]);
  });
});
