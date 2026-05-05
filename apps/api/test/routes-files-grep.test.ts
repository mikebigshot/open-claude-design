import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type { Project } from '@open-design/contracts';

// Real route shape (apps/api/src/routes/files-grep.ts):
//   POST /api/projects/:projectId/grep
//        body: { pattern: string, include?: string }
//        → 200 { ok: true, matches: { path, line, text }[], truncated: boolean } | 400

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

interface GrepResponse {
  ok: boolean;
  matches: { path: string; line: number; text: string }[];
  truncated: boolean;
}

describe('routes/files-grep', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('finds substring matches across multiple files, line-numbered', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.jsx', 'line1\nhello world\nline3\n');
    await putFile(app, projectId, 'b.jsx', 'no match here\nstill nothing\n');
    await putFile(app, projectId, 'c.jsx', 'hello again\nhello once more\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'hello' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as GrepResponse;
    expect(body.ok).toBe(true);
    expect(body.truncated).toBe(false);
    expect(body.matches).toEqual([
      { path: 'a.jsx', line: 2, text: 'hello world' },
      { path: 'c.jsx', line: 1, text: 'hello again' },
      { path: 'c.jsx', line: 2, text: 'hello once more' },
    ]);
  });

  it('respects the `include` substring filter on file path', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'src/foo.jsx', 'needle\n');
    await putFile(app, projectId, 'docs/readme.md', 'needle\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'needle', include: 'src' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches.map((m) => m.path)).toEqual(['src/foo.jsx']);
  });

  it('returns empty matches when nothing hits', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'x.txt', 'totally unrelated\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'xenomorph' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches).toEqual([]);
    expect(body.truncated).toBe(false);
  });

  it('rejects empty pattern with 400', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_request');
  });

  it('truncates per-line text to 300 chars', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const longLine = 'needle ' + 'x'.repeat(500);
    await putFile(app, projectId, 'big.txt', longLine + '\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'needle' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches[0]?.text.length).toBe(300);
  });
});
