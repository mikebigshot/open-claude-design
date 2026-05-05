import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type {
  Comment,
  CreateCommentResponse,
  ListCommentsResponse,
  Project,
} from '@open-design/contracts';

// Routes under test (apps/api/src/routes/comments.ts):
//   GET    /api/projects/:id/comments              → 200 { comments } | 404
//   POST   /api/projects/:id/comments              → 201 { comment }  | 400 / 404
//   DELETE /api/projects/:id/comments/:commentId   → 204              | 404

const BASE_PROJECT = {
  name: 'Test Comments Project',
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

/**
 * miniflare uses isolatedStorage:false so the comments table is shared across
 * test files. id is the global PK — reusing literal ids like "p1" across tests
 * causes the second insert to UPDATE the first project's row (project_id not
 * in the ON CONFLICT SET clause). In real usage clients send crypto.randomUUID,
 * so we mirror that here with a per-test prefix to avoid collisions.
 */
let pinSeq = 0;
function uniqueId(label: string): string {
  pinSeq += 1;
  return `${label}-${pinSeq}-${crypto.randomUUID()}`;
}

function pinPayload(
  id: string,
  overrides: Partial<{ n: number; x: number; y: number; text: string; selector: string }> = {},
) {
  return {
    id,
    n: overrides.n ?? 1,
    x: overrides.x ?? 100,
    y: overrides.y ?? 200,
    text: overrides.text ?? 'looks great',
    ...(overrides.selector !== undefined ? { selector: overrides.selector } : {}),
  };
}

describe('routes/comments', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('GET returns 404 for unknown project', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/no-such-project/comments', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('GET returns empty list for fresh project', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/comments`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListCommentsResponse;
    expect(body.comments).toEqual([]);
  });

  it('POST creates a pin and GET round-trips it', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const id = uniqueId('round-trip');

    const postRes = await app.request(`/api/projects/${project.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        pinPayload(id, { n: 1, x: 12.5, y: 99, text: 'hello', selector: '.btn' }),
      ),
    });
    expect(postRes.status).toBe(201);
    const created = ((await postRes.json()) as CreateCommentResponse).comment;
    expect(created.id).toBe(id);
    expect(created.projectId).toBe(project.id);
    expect(created.n).toBe(1);
    expect(created.x).toBe(12.5);
    expect(created.y).toBe(99);
    expect(created.text).toBe('hello');
    expect(created.selector).toBe('.btn');
    expect(created.createdAt).toBeTruthy();

    const getRes = await app.request(`/api/projects/${project.id}/comments`, { method: 'GET' });
    const body = (await getRes.json()) as ListCommentsResponse;
    expect(body.comments).toEqual([created]);
  });

  it('GET returns pins ordered by n ascending', async () => {
    const app = makeTestApp();
    const project = await createProject(app);

    for (const n of [3, 1, 2]) {
      await app.request(`/api/projects/${project.id}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pinPayload(uniqueId(`order-${n}`), { n })),
      });
    }
    const res = await app.request(`/api/projects/${project.id}/comments`, { method: 'GET' });
    const body = (await res.json()) as ListCommentsResponse;
    expect(body.comments.map((c: Comment) => c.n)).toEqual([1, 2, 3]);
  });

  it('POST is idempotent on duplicate id (retry-safe)', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const id = uniqueId('dup');

    await app.request(`/api/projects/${project.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pinPayload(id, { text: 'original' })),
    });
    // Same id, different text — should overwrite, not duplicate.
    await app.request(`/api/projects/${project.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pinPayload(id, { text: 'updated' })),
    });

    const res = await app.request(`/api/projects/${project.id}/comments`, { method: 'GET' });
    const body = (await res.json()) as ListCommentsResponse;
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]!.text).toBe('updated');
  });

  it('POST returns 400 when id is missing', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 1, x: 0, y: 0, text: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST returns 404 for unknown project', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/no-such-project/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pinPayload(uniqueId('not-found'))),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE removes a pin and returns 204', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const id = uniqueId('to-delete');
    await app.request(`/api/projects/${project.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pinPayload(id)),
    });

    const delRes = await app.request(`/api/projects/${project.id}/comments/${id}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(204);

    const getRes = await app.request(`/api/projects/${project.id}/comments`, { method: 'GET' });
    expect(((await getRes.json()) as ListCommentsResponse).comments).toEqual([]);
  });

  it('DELETE returns 404 for unknown comment id', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/comments/no-such-id`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('Project DELETE cascades comments', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    await app.request(`/api/projects/${project.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(pinPayload(uniqueId('cascade'))),
    });

    await app.request(`/api/projects/${project.id}`, { method: 'DELETE' });

    // Recreate project and verify comments are gone (FK ON DELETE CASCADE).
    const fresh = await createProject(app);
    const res = await app.request(`/api/projects/${fresh.id}/comments`, { method: 'GET' });
    expect(((await res.json()) as ListCommentsResponse).comments).toEqual([]);
  });
});
