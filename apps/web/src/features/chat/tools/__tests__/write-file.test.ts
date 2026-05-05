import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileTool } from '../write-file';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

afterEach(() => vi.restoreAllMocks());

describe('write_file', () => {
  it('PUTs content and returns sha256 + size on 200', async () => {
    let calledUrl = '';
    let method = '';
    let body: unknown;
    let contentType = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      method = init?.method ?? '';
      body = JSON.parse(String(init?.body));
      contentType = new Headers(init?.headers).get('content-type') ?? '';
      return new Response(JSON.stringify({ sha256: 'deadbeef', size: 11 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const r = await writeFileTool('p1').execute!({ path: 'App.jsx', content: 'hello world' }, ctx);
    expect(r).toEqual({ ok: true, path: 'App.jsx', sha256: 'deadbeef', size: 11 });
    expect(calledUrl).toBe('/api/projects/p1/files/App.jsx');
    expect(method).toBe('PUT');
    expect(contentType).toBe('application/json');
    expect(body).toEqual({ content: 'hello world' });
  });

  it('omits asset/mimeType from body when not provided', async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ sha256: 'a', size: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await writeFileTool('p1').execute!({ path: 'A.jsx', content: 'x' }, ctx);
    expect(body).toEqual({ content: 'x' });
    expect(body).not.toHaveProperty('asset');
    expect(body).not.toHaveProperty('mimeType');
  });

  it('includes asset and mimeType when provided', async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ sha256: 'a', size: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await writeFileTool('p1').execute!(
      { path: 'index.html', content: '<html/>', asset: 'home', mimeType: 'text/html' },
      ctx,
    );
    expect(body).toEqual({
      content: '<html/>',
      asset: 'home',
      mimeType: 'text/html',
    });
  });

  it('handles empty content', async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ sha256: 'empty', size: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const r = await writeFileTool('p1').execute!({ path: 'empty.txt', content: '' }, ctx);
    expect(body).toEqual({ content: '' });
    expect(r).toEqual({ ok: true, path: 'empty.txt', sha256: 'empty', size: 0 });
  });

  it('throws on non-2xx response', async () => {
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500, statusText: 'Server Error' })) as typeof fetch;
    await expect(
      writeFileTool('p1').execute!({ path: 'A.jsx', content: 'x' }, ctx),
    ).rejects.toThrow('write_file failed: 500');
  });

  it('encodes path with subdirectories (preserves slashes)', async () => {
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({ sha256: 'a', size: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    await writeFileTool('p1').execute!({ path: 'src/components/Header.tsx', content: 'x' }, ctx);
    expect(calledUrl).toBe('/api/projects/p1/files/src/components/Header.tsx');
  });

  it('treats explicit asset: "" as a provided value (not undefined)', async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ sha256: 'a', size: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    // Per source code: only `asset !== undefined` gets included; empty string IS included
    await writeFileTool('p1').execute!({ path: 'A.jsx', content: 'x', asset: '' }, ctx);
    expect(body).toEqual({ content: 'x', asset: '' });
  });
});
