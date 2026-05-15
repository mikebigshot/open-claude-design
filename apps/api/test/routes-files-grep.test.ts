import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type { Project } from '@open-design/contracts';

// Aligned with official Claude Design `grep`:
//   POST /api/projects/:projectId/grep
//     body: { pattern: string (regex), path?: string (dir prefix or file scope) }
//     → 200 {
//         ok: true,
//         matches: { path, line, before[], match, after[] }[],
//         truncated: boolean
//       }
//   Case-insensitive regex. Up to 100 matches. ±2 lines context.

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

interface GrepMatch {
  path: string;
  line: number;
  before: string[];
  match: string;
  after: string[];
}

interface GrepResponse {
  ok: boolean;
  matches: GrepMatch[];
  truncated: boolean;
}

describe('routes/files-grep', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('finds literal substring matches across multiple files', async () => {
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
    expect(body.matches.map((m) => `${m.path}:${m.line}`)).toEqual([
      'a.jsx:2',
      'c.jsx:1',
      'c.jsx:2',
    ]);
  });

  it('treats pattern as a regex (case-insensitive by default)', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.txt', 'HELLO world\nhello again\nHeLLo lower\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'hello' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches.map((m) => m.line)).toEqual([1, 2, 3]);
  });

  it('supports regex special chars (e.g. dot wildcard)', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.txt', 'foo\nfxo\nfaa\nf!o\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'f.o' }),
    });
    const body = (await res.json()) as GrepResponse;
    // f.o matches foo, fxo, f!o (not faa — "aa" no match for .o)
    expect(body.matches.map((m) => m.match).sort()).toEqual(['f!o', 'foo', 'fxo']);
  });

  it('includes ±2 lines of context per match', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.txt', 'L1\nL2\nL3\nMATCH\nL5\nL6\nL7\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'MATCH' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches).toHaveLength(1);
    const m = body.matches[0]!;
    expect(m.line).toBe(4);
    expect(m.before).toEqual(['L2', 'L3']);
    expect(m.match).toBe('MATCH');
    expect(m.after).toEqual(['L5', 'L6']);
  });

  it('clips context near the file start / end', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.txt', 'MATCH at top\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'MATCH' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches[0]!.before).toEqual([]);
    expect(body.matches[0]!.after).toEqual(['']); // trailing newline → empty last line
  });

  it('honors `path` as a directory prefix scope', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'src/foo.jsx', 'needle\n');
    await putFile(app, projectId, 'docs/readme.md', 'needle\n');
    await putFile(app, projectId, 'srcbad/other.txt', 'needle\n'); // prefix string match shouldn't hit "srcbad"

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'needle', path: 'src/' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches.map((m) => m.path)).toEqual(['src/foo.jsx']);
  });

  it('honors `path` as a single file scope (exact match)', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.txt', 'needle\n');
    await putFile(app, projectId, 'b.txt', 'needle\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'needle', path: 'a.txt' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches.map((m) => m.path)).toEqual(['a.txt']);
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

  it('caps results at 100 matches with truncated:true', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    // 150 lines containing the pattern
    const lines = Array.from({ length: 150 }, (_, i) => `hit ${i + 1}`).join('\n');
    await putFile(app, projectId, 'big.txt', lines);

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'hit' }),
    });
    const body = (await res.json()) as GrepResponse;
    expect(body.matches).toHaveLength(100);
    expect(body.truncated).toBe(true);
  });

  it('rejects empty pattern with 400 bad_request', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid regex with 400 bad_pattern', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'x.txt', 'anything\n');

    const res = await app.request(`/api/projects/${projectId}/grep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Unmatched opening group → invalid regex
      body: JSON.stringify({ pattern: '(unclosed' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad_pattern');
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
    expect(body.matches[0]?.match.length).toBe(300);
  });
});
