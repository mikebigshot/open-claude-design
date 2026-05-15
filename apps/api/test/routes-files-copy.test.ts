import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type { Project } from '@open-design/contracts';

// Per-file copy/rename batch:
//   POST /api/projects/:projectId/files/copy
//        body: { files: [{src, dest, move?, asset?}] }
//        → 200 { ok: true, results: [{src, dest, moved}, ...] } | 400

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

interface CopyResponse {
  ok: boolean;
  results: { src: string; dest: string; moved: boolean }[];
}

describe('routes/files-copy', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('copies a file to its dest path with per-file dest', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'src/App.jsx', 'export default () => null;');

    const res = await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ src: 'src/App.jsx', dest: 'backup/App.jsx' }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CopyResponse;
    expect(body.ok).toBe(true);
    expect(body.results).toEqual([{ src: 'src/App.jsx', dest: 'backup/App.jsx', moved: false }]);

    const fetchRes = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('backup/App.jsx')}`,
    );
    expect(fetchRes.status).toBe(200);
    expect(await fetchRes.text()).toBe('export default () => null;');
  });

  it('renames a file when move:true (src deleted)', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'old.md', 'doc');

    const res = await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: [{ src: 'old.md', dest: 'new.md', move: true }] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CopyResponse;
    expect(body.results[0]).toEqual({ src: 'old.md', dest: 'new.md', moved: true });

    // src is gone
    const srcRes = await app.request(`/api/projects/${projectId}/files/old.md`);
    expect(srcRes.status).toBe(404);
    // dest readable
    const dstRes = await app.request(`/api/projects/${projectId}/files/new.md`);
    expect(dstRes.status).toBe(200);
    expect(await dstRes.text()).toBe('doc');
  });

  it('records moved:false for missing src entries (silently skipped)', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'real.txt', 'present');

    const res = await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: [
          { src: 'ghost.txt', dest: 'dst/ghost.txt' },
          { src: 'real.txt', dest: 'dst/real.txt' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CopyResponse;
    expect(body.results.map((r) => r.src)).toEqual(['ghost.txt', 'real.txt']);
    // Real file copied; ghost row exists in results with moved:false but
    // doesn't actually create a phantom dest row.
    const ghostRes = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('dst/ghost.txt')}`,
    );
    expect(ghostRes.status).toBe(404);
    const realRes = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('dst/real.txt')}`,
    );
    expect(realRes.status).toBe(200);
  });

  it('rejects malformed body with 400 bad_request', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);

    const res = await app.request(`/api/projects/${projectId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: ['x.txt'] }), // old shape
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_request');
  });

  it('copies cross-project src via /projects/<id>/<path> syntax', async () => {
    const app = makeTestApp();
    const sourceId = await createProject(app);
    const destId = await createProject(app);
    await putFile(app, sourceId, 'shared.css', 'h1{}');

    const res = await app.request(`/api/projects/${destId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: [{ src: `/projects/${sourceId}/shared.css`, dest: 'imported.css' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CopyResponse;
    expect(body.results[0]?.dest).toBe('imported.css');

    const fetched = await app.request(`/api/projects/${destId}/files/imported.css`);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe('h1{}');
  });

  it('rejects cross-project move:true (security guard)', async () => {
    const app = makeTestApp();
    const sourceId = await createProject(app);
    const destId = await createProject(app);
    await putFile(app, sourceId, 'mine.txt', 'x');
    const res = await app.request(`/api/projects/${destId}/files/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: [{ src: `/projects/${sourceId}/mine.txt`, dest: 'stolen.txt', move: true }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('cross_project_move_forbidden');
  });

  it('reuses the same blob (sha256 stays identical)', async () => {
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
      body: JSON.stringify({
        files: [{ src: 'shared.txt', dest: 'mirror/shared.txt' }],
      }),
    });

    const after = await app.request(`/api/projects/${projectId}/files`);
    const afterBody = (await after.json()) as {
      files: { path: string; sha256: string }[];
    };
    const copy = afterBody.files.find((f) => f.path === 'mirror/shared.txt');
    expect(copy?.sha256).toBe(sourceSha);
  });
});
