import { afterEach, describe, expect, it, vi } from 'vitest';
import { listFilesTool } from '../list-files';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

afterEach(() => vi.restoreAllMocks());

describe('list_files', () => {
  it('returns the files array from the worker on 200', async () => {
    const files = [
      { path: 'App.jsx', size: 123, mimeType: 'text/jsx', updatedAt: '2026-05-03T00:00:00Z' },
      { path: 'index.html', size: 50, mimeType: 'text/html', updatedAt: '2026-05-03T00:01:00Z' },
    ];
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({ files }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const r = await listFilesTool('p1').execute!({}, ctx);
    expect(r).toEqual({ ok: true, files });
    expect(calledUrl).toBe('/api/projects/p1/files');
  });

  it('returns ok with empty array when project has no files', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const r = await listFilesTool('p1').execute!({}, ctx);
    expect(r).toEqual({ ok: true, files: [] });
  });

  it('throws on 5xx response (lets agent retry)', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500, statusText: 'Server Error' })) as typeof fetch;
    await expect(listFilesTool('p1').execute!({}, ctx)).rejects.toThrow('list_files failed: 500');
  });

  it('returns friendly { ok: false, error: "not_found" } on 404 (matches read_file)', async () => {
    globalThis.fetch = (async () =>
      new Response('not found', { status: 404, statusText: 'Not Found' })) as typeof fetch;
    const r = await listFilesTool('p1').execute!({}, ctx);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it("throws on 401/403 (auth errors aren't friendly)", async () => {
    globalThis.fetch = (async () =>
      new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })) as typeof fetch;
    await expect(listFilesTool('p1').execute!({}, ctx)).rejects.toThrow('list_files failed: 401');
  });

  it('encodes projectId via encodeURIComponent', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    await listFilesTool('proj with space').execute!({}, ctx);
    expect(calledUrl).toBe('/api/projects/proj%20with%20space/files');
  });

  it('uses GET method', async () => {
    let method = '';
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      method = init?.method ?? 'GET';
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    await listFilesTool('p1').execute!({}, ctx);
    expect(method).toBe('GET');
  });
});
