// share-token mint + signed URL fetch end-to-end.

import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type { Project } from '@open-design/contracts';

async function createProject(app: ReturnType<typeof makeTestApp>): Promise<string> {
  const res = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'P', type: 'prototype', fidelity: 'wireframe' }),
  });
  expect(res.status).toBe(201);
  return (await res.json<Project>()).id;
}

async function putFile(
  app: ReturnType<typeof makeTestApp>,
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  const res = await app.request(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  expect(res.status).toBe(200);
}

describe('routes/share', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('mints a signed URL + fetching the URL serves the file bytes', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'app.html', '<html>hi</html>');

    const mint = await app.request(`/api/projects/${projectId}/share-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'app.html' }),
    });
    expect(mint.status).toBe(200);
    const body = (await mint.json()) as { url: string; expiresAt: string };
    expect(body.url).toContain('/api/share/');
    expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Strip the host so makeTestApp serves it.
    const relative = body.url.replace(/^https?:\/\/[^/]+/, '');
    const fetched = await app.request(relative);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe('<html>hi</html>');
  });

  it('rejects an unsigned request', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.html', 'x');
    const res = await app.request(`/api/share/${projectId}/a.html?expires=9999999999&sig=bogus`);
    expect(res.status).toBe(403);
  });

  it('rejects expired tokens', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.html', 'x');
    const mint = await app.request(`/api/projects/${projectId}/share-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'a.html', ttl: 60 }),
    });
    const body = (await mint.json()) as { url: string };
    // Rewrite expires= to be in the past.
    const u = new URL(body.url);
    u.searchParams.set('expires', '1');
    const relative = u.pathname + u.search;
    const res = await app.request(relative);
    expect(res.status).toBe(410);
  });

  it('returns 400 for missing path', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await app.request(`/api/projects/${projectId}/share-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
