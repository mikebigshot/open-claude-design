import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileTool } from '../read-file';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

afterEach(() => vi.restoreAllMocks());

describe('read_file', () => {
  it('returns file content on 200', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response('hello world\nbye world', { status: 200 });
    }) as typeof fetch;

    const r = await readFileTool('p1').execute!({ path: 'A.jsx' }, ctx);
    expect(r).toEqual({ ok: true, path: 'A.jsx', content: 'hello world\nbye world' });
    expect(calledUrl).toBe('/api/projects/p1/files/A.jsx');
  });

  it('returns not_found on 404 (does not throw)', async () => {
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as typeof fetch;
    const r = await readFileTool('p1').execute!({ path: 'missing.jsx' }, ctx);
    expect(r).toMatchObject({ ok: false, error: 'not_found', path: 'missing.jsx' });
  });

  it('throws on non-2xx, non-404 response', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500, statusText: 'Server Error' })) as typeof fetch;
    await expect(readFileTool('p1').execute!({ path: 'A.jsx' }, ctx)).rejects.toThrow(
      'read_file failed: 500',
    );
  });

  it('handles empty file content', async () => {
    globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch;
    const r = await readFileTool('p1').execute!({ path: 'empty.txt' }, ctx);
    expect(r).toEqual({ ok: true, path: 'empty.txt', content: '' });
  });

  it('encodes path with subdirectories (preserves slashes via encodeURI)', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response('content', { status: 200 });
    }) as typeof fetch;
    await readFileTool('p1').execute!({ path: 'src/components/Header.tsx' }, ctx);
    // encodeURI keeps `/` intact (unlike encodeURIComponent)
    expect(calledUrl).toBe('/api/projects/p1/files/src/components/Header.tsx');
  });

  it('encodes spaces in path with encodeURI', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response('x', { status: 200 });
    }) as typeof fetch;
    await readFileTool('p1').execute!({ path: 'My File.jsx' }, ctx);
    expect(calledUrl).toBe('/api/projects/p1/files/My%20File.jsx');
  });

  it('encodes projectId via encodeURIComponent', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response('x', { status: 200 });
    }) as typeof fetch;
    await readFileTool('proj/with-slash').execute!({ path: 'A.jsx' }, ctx);
    // projectId is encodeURIComponent-encoded: `/` becomes `%2F`
    expect(calledUrl).toBe('/api/projects/proj%2Fwith-slash/files/A.jsx');
  });
});
