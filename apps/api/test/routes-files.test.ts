import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import { getBlobCount } from './helpers/blob-count.js';
import type { Project } from '@open-design/contracts';

// Real route shape (apps/api/src/routes/files.ts):
//   GET  /api/projects/:id/files                  → 200 { files: FileRecord[] }
//   GET  /api/projects/:id/files/{path}           → 200 raw bytes + content-type / x-content-hash / etag | 404
//   PUT  /api/projects/:id/files/{path}           → 200 { path, sha256, size, version } | 400

const SHA256_HEX = /^[0-9a-f]{64}$/;

async function createProject(app: ReturnType<typeof makeTestApp>) {
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
  mimeType?: string,
) {
  const res = await app.request(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, ...(mimeType ? { mimeType } : {}) }),
  });
  return res;
}

describe('routes/files', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  // -------------------------------------------------------------------------
  // PUT happy path
  // -------------------------------------------------------------------------

  it('PUT writes a new file and returns sha256/size/version=1 with inferred jsx mime', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await putFile(app, projectId, 'App.jsx', 'export default () => null;');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      path: string;
      sha256: string;
      size: number;
      version: number;
    };
    expect(body.path).toBe('App.jsx');
    expect(body.sha256).toMatch(SHA256_HEX);
    expect(body.size).toBe(new TextEncoder().encode('export default () => null;').byteLength);
    expect(body.version).toBe(1);
  });

  it('PUT same path with different content bumps version and changes sha256', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const r1 = await putFile(app, projectId, 'A.jsx', 'one');
    const b1 = (await r1.json()) as { sha256: string; version: number };
    const r2 = await putFile(app, projectId, 'A.jsx', 'two');
    const b2 = (await r2.json()) as { sha256: string; version: number };
    expect(b2.sha256).not.toBe(b1.sha256);
    expect(b2.version).toBe(b1.version + 1);
  });

  it('PUT same path same content keeps sha256 stable but still bumps version', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const r1 = await putFile(app, projectId, 'A.jsx', 'same');
    const b1 = (await r1.json()) as { sha256: string; version: number };
    const r2 = await putFile(app, projectId, 'A.jsx', 'same');
    const b2 = (await r2.json()) as { sha256: string; version: number };
    expect(b2.sha256).toBe(b1.sha256);
    expect(b2.version).toBe(b1.version + 1);
  });

  it('PUT nested path (urlencoded) round-trips correctly', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await putFile(app, projectId, 'src/components/Header.tsx', 'tsx');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe('src/components/Header.tsx');
  });

  it('PUT infers mime by extension when mimeType not supplied', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.html', '<p>x</p>');
    await putFile(app, projectId, 'a.png', 'png-bytes');
    await putFile(app, projectId, 'a.json', '{}');
    await putFile(app, projectId, 'a.tsx', 'tsx');
    await putFile(app, projectId, 'a.css', 'css');
    await putFile(app, projectId, 'a.svg', '<svg/>');
    await putFile(app, projectId, 'a.xyz', 'unknown');

    const list = await app.request(`/api/projects/${projectId}/files`);
    const { files } = (await list.json()) as {
      files: Array<{ path: string; mimeType: string }>;
    };
    const map = new Map(files.map((f) => [f.path, f.mimeType]));
    expect(map.get('a.html')).toBe('text/html');
    expect(map.get('a.png')).toBe('image/png');
    expect(map.get('a.json')).toBe('application/json');
    expect(map.get('a.tsx')).toBe('text/jsx');
    expect(map.get('a.css')).toBe('text/css');
    expect(map.get('a.svg')).toBe('image/svg+xml');
    expect(map.get('a.xyz')).toBe('text/plain');
  });

  it('PUT with explicit mimeType overrides inference', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'mystery.dat', 'bytes', 'image/png');
    const list = await app.request(`/api/projects/${projectId}/files`);
    const { files } = (await list.json()) as {
      files: Array<{ path: string; mimeType: string }>;
    };
    expect(files.find((f) => f.path === 'mystery.dat')?.mimeType).toBe('image/png');
  });

  it('PUT body without string content returns 400 invalid_request', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await app.request(`/api/projects/${projectId}/files/Bad.jsx`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 123 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_request');
  });

  // -------------------------------------------------------------------------
  // GET ListFiles
  // -------------------------------------------------------------------------

  it('GET ListFiles returns empty array for fresh project', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await app.request(`/api/projects/${projectId}/files`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: unknown[] };
    expect(body.files).toEqual([]);
  });

  it('GET ListFiles returns FileRecord shape for written files', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'A.jsx', 'one');
    await putFile(app, projectId, 'B.jsx', 'two');
    const res = await app.request(`/api/projects/${projectId}/files`);
    const body = (await res.json()) as {
      files: Array<{
        projectId: string;
        path: string;
        sha256: string;
        size: number;
        mimeType: string;
        updatedAt: string;
      }>;
    };
    expect(body.files).toHaveLength(2);
    for (const f of body.files) {
      expect(f.projectId).toBe(projectId);
      expect(f.sha256).toMatch(SHA256_HEX);
      expect(f.size).toBeGreaterThan(0);
      expect(f.mimeType).toBe('text/jsx');
      expect(typeof f.updatedAt).toBe('string');
      // FileRecord 不包含 version（内部实现细节，不应泄漏）
      expect((f as Record<string, unknown>).version).toBeUndefined();
    }
  });

  // -------------------------------------------------------------------------
  // GET file by path
  // -------------------------------------------------------------------------

  it('GET by path returns body bytes + x-content-hash header + etag', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const content = 'console.log("hi")';
    const r1 = await putFile(app, projectId, 'A.jsx', content);
    const { sha256 } = (await r1.json()) as { sha256: string };

    const res = await app.request(`/api/projects/${projectId}/files/A.jsx`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-hash')).toBe(sha256);
    expect(res.headers.get('etag')).toBe(`"${sha256}"`);
    expect(res.headers.get('content-type')).toBe('text/jsx');
    expect(await res.text()).toBe(content);
  });

  it('GET non-existent path returns 404 not_found', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await app.request(`/api/projects/${projectId}/files/Nope.jsx`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('GET nested path (urlencoded) round-trips correctly', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const path = 'src/components/Header.tsx';
    const content = 'tsx-content';
    await putFile(app, projectId, path, content);
    const res = await app.request(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(content);
  });

  // -------------------------------------------------------------------------
  // sha256 dedupe (内容寻址核心)
  // -------------------------------------------------------------------------

  it('sha256 dedupes blobs across different paths with same content', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);

    const before = await getBlobCount();
    await putFile(app, projectId, 'one.jsx', 'duplicate-content');
    const afterFirst = await getBlobCount();
    await putFile(app, projectId, 'two.jsx', 'duplicate-content');
    const afterSecond = await getBlobCount();

    // 两次 PUT 同 content 应该只新增 1 行 blob（因为 sha256 一样）
    expect(afterFirst - before).toBe(1);
    expect(afterSecond - afterFirst).toBe(0);
  });

  // ─── Binary upload (image/*) ────────────────────────────────────────

  it('PUT accepts raw image bytes when content-type is image/*', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    // 1×1 transparent PNG（最小合法 PNG，68 bytes）
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00,
      0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const res = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('uploads/test.png')}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: pngBytes,
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      path: string;
      sha256: string;
      size: number;
      version: number;
    };
    expect(body.path).toBe('uploads/test.png');
    expect(body.sha256).toMatch(SHA256_HEX);
    expect(body.size).toBe(pngBytes.byteLength);
    expect(body.version).toBe(1);
  });

  it('GET round-trips raw image bytes with original content-type', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const putRes = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('uploads/r.png')}`,
      { method: 'PUT', headers: { 'content-type': 'image/png' }, body: pngBytes },
    );
    expect(putRes.status).toBe(200);
    const getRes = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('uploads/r.png')}`,
    );
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toBe('image/png');
    const back = new Uint8Array(await getRes.arrayBuffer());
    expect(Array.from(back)).toEqual(Array.from(pngBytes));
  });

  it('PUT JSON {content} path still works (no regression)', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await putFile(app, projectId, 'kept.tsx', 'export const x = 1;');
    expect(res.status).toBe(200);
  });

  // ─── MIME allowlist (anti stored-XSS / contract-break) ──────────────

  it('PUT image/png; charset=utf-8 strips charset and stores image/png', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await app.request(`/api/projects/${projectId}/files/${encodeURIComponent('uploads/p.png')}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png; charset=utf-8' },
      body: pngBytes,
    });
    const res = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('uploads/p.png')}`,
    );
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('PUT non-allowlist mime falls back to inferMime by extension', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const bytes = new TextEncoder().encode('<h1>hi</h1>');
    await app.request(`/api/projects/${projectId}/files/${encodeURIComponent('evil.png')}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/x-evil' },
      body: bytes,
    });
    const res = await app.request(
      `/api/projects/${projectId}/files/${encodeURIComponent('evil.png')}`,
    );
    // mime fallback to inferMime('evil.png') = 'image/png'（路径后缀）
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('PUT JSON with unsupported body.mimeType falls back to inferMime', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await app.request(`/api/projects/${projectId}/files/x.tsx`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'export const a = 1;', mimeType: 'application/x-evil' }),
    });
    expect(res.status).toBe(200);
    const get = await app.request(`/api/projects/${projectId}/files/x.tsx`);
    expect(get.headers.get('content-type')).toBe('text/jsx');
  });

  it('isAllowedMime: union members yes, garbage no', async () => {
    const { isAllowedMime } = await import('@open-design/contracts');
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('text/jsx')).toBe(true);
    expect(isAllowedMime('application/json')).toBe(true);
    expect(isAllowedMime('text/x-evil')).toBe(false);
    expect(isAllowedMime('')).toBe(false);
    expect(isAllowedMime('image/png; charset=utf-8')).toBe(false); // not split, raw not in list
  });
});
