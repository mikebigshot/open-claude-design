import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type { Project } from '@open-design/contracts';

// Real route shape (apps/api/src/routes/files-copy.ts):
//   POST /api/projects/:projectId/files/copy
//        body: { sources: string[], destDir: string }
//        → 200 { ok: true, copied: { from, to }[] } | 400

async function createProject(app: ReturnType<typeof makeTestApp>): Promise<string> {
  const res = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'P', type: 'prototype', fidelity: 'wireframe' }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as Project;
  return body.id;
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

describe('routes/files-copy', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('copies an existing file to a new dest dir, preserving filename', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'src/App.jsx', 'export default () => null;');

    const res = await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: ['src/App.jsx'], destDir: 'backup' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; copied: { from: string; to: string }[] };
    expect(body.ok).toBe(true);
    expect(body.copied).toEqual([{ from: 'src/App.jsx', to: 'backup/App.jsx' }]);

    // Sanity: the copy is readable.
    const fetchRes = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('backup/App.jsx')}`,
    );
    expect(fetchRes.status).toBe(200);
    expect(await fetchRes.text()).toBe('export default () => null;');
  });

  it('strips a trailing slash on destDir', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.txt', 'hi');

    const res = await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: ['a.txt'], destDir: 'archive/' }),
    });
    const body = (await res.json()) as { copied: { from: string; to: string }[] };
    expect(body.copied[0]?.to).toBe('archive/a.txt');
  });

  it('silently skips sources that do not exist (returns empty copied)', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'real.txt', 'present');

    const res = await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: ['ghost.txt', 'real.txt'], destDir: 'dst' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { copied: { from: string; to: string }[] };
    expect(body.copied).toEqual([{ from: 'real.txt', to: 'dst/real.txt' }]);
  });

  it('rejects malformed body with 400', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);

    // Missing destDir.
    const res = await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: ['x.txt'] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_request');
  });

  it('reuses the same blob (no re-upload) — the sha256 stays identical', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'shared.txt', 'one body');

    const before = await app.request(`/api/projects/${projectId}/files`);
    const beforeBody = (await before.json()) as {
      files: { path: string; sha256: string }[];
    };
    const sourceSha = beforeBody.files.find((f) => f.path === 'shared.txt')!.sha256;

    await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: ['shared.txt'], destDir: 'mirror' }),
    });

    const after = await app.request(`/api/projects/${projectId}/files`);
    const afterBody = (await after.json()) as {
      files: { path: string; sha256: string }[];
    };
    const copy = afterBody.files.find((f) => f.path === 'mirror/shared.txt');
    expect(copy?.sha256).toBe(sourceSha);
  });
});
