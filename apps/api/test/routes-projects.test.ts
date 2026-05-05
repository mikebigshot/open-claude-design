import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type { Project } from '@open-design/contracts';

// Real route shape (from apps/api/src/routes/projects.ts):
//   POST   /api/projects          → 201 flat Project (name+type+fidelity required; 400 if missing)
//   GET    /api/projects          → 200 { projects: Project[] } (ordered by updated_at DESC)
//   GET    /api/projects/:id      → 200 flat Project | 404
//   PATCH  /api/projects/:id      → 200 flat Project | 404
//   DELETE /api/projects/:id      → 204 no body    | 404

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE_PROJECT = {
  name: 'Test Project',
  type: 'prototype' as const,
  fidelity: 'wireframe' as const,
};

describe('routes/projects', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------

  it('POST /api/projects creates a project and returns 201 with flat Project body', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BASE_PROJECT),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Project;
    expect(body.id).toMatch(UUID_RE);
    expect(body.name).toBe('Test Project');
    expect(body.type).toBe('prototype');
    expect(body.fidelity).toBe('wireframe');
    expect(body.designSystemId).toBeNull();
    expect(body.createdAt).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
  });

  it('POST /api/projects returns 400 when required fields are missing', async () => {
    const app = makeTestApp();
    // Missing type and fidelity
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Only Name' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('invalid_request');
  });

  it('POST /api/projects accepts optional designSystemId', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BASE_PROJECT, designSystemId: 'ds-abc' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Project;
    expect(body.designSystemId).toBe('ds-abc');
  });

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------

  it('GET /api/projects returns { projects: [...] } ordered newest first', async () => {
    const app = makeTestApp();

    // Create two projects; rely on insertion order (both get the same ms timestamp
    // in fast environments, so we check containment rather than strict ordering).
    await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BASE_PROJECT, name: 'Older Project' }),
    });
    // Delay to ensure distinct updated_at timestamps (ISO strings have ms precision)
    await new Promise((r) => setTimeout(r, 10));
    await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BASE_PROJECT, name: 'Newer Project' }),
    });

    const list = await app.request('/api/projects', { method: 'GET' });
    expect(list.status).toBe(200);
    const data = (await list.json()) as { projects: Project[] };
    expect(Array.isArray(data.projects)).toBe(true);
    expect(data.projects.length).toBeGreaterThanOrEqual(2);

    const names = data.projects.map((p) => p.name);
    expect(names).toContain('Newer Project');
    expect(names).toContain('Older Project');

    // Newer should appear before Older (DESC by updated_at)
    expect(names.indexOf('Newer Project')).toBeLessThan(names.indexOf('Older Project'));
  });

  it('GET /api/projects respects limit and offset query params', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects?limit=1&offset=0', { method: 'GET' });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { projects: Project[] };
    expect(data.projects.length).toBeLessThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // GET single
  // ---------------------------------------------------------------------------

  it('GET /api/projects/:id returns the project', async () => {
    const app = makeTestApp();
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BASE_PROJECT, name: 'Fetch Me' }),
    });
    const created = (await createRes.json()) as Project;

    const getRes = await app.request(`/api/projects/${created.id}`, { method: 'GET' });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as Project;
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Fetch Me');
  });

  it('GET /api/projects/:id returns 404 for unknown id', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/nonexistent-id-000', { method: 'GET' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  // ---------------------------------------------------------------------------
  // PATCH
  // ---------------------------------------------------------------------------

  it('PATCH /api/projects/:id updates name and returns updated Project', async () => {
    const app = makeTestApp();
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BASE_PROJECT, name: 'Original Name' }),
    });
    const created = (await createRes.json()) as Project;

    const patchRes = await app.request(`/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as Project;
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('Updated Name');
  });

  it('PATCH /api/projects/:id returns 404 for unknown id', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/nonexistent-id-patch', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Whatever' }),
    });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------------------

  it('DELETE /api/projects/:id deletes the project and returns 204', async () => {
    const app = makeTestApp();
    const createRes = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BASE_PROJECT, name: 'Delete Me' }),
    });
    const created = (await createRes.json()) as Project;

    const deleteRes = await app.request(`/api/projects/${created.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(204);

    // Verify it's gone
    const getRes = await app.request(`/api/projects/${created.id}`, { method: 'GET' });
    expect(getRes.status).toBe(404);
  });

  it('DELETE /api/projects/:id returns 404 for unknown id', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/nonexistent-id-delete', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
