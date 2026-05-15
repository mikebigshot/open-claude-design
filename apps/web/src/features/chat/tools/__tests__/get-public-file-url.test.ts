// get_public_file_url — wraps POST /share-token.

import { describe, expect, it } from 'vitest';
import { getPublicFileUrlTool } from '../get-public-file-url';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('get_public_file_url', () => {
  it('rejects empty path', () => {
    const t = getPublicFileUrlTool('p');
    expect(asSchema(t.inputSchema)?.safeParse({ path: '' }).success).toBe(false);
  });

  it('rejects ttl > 86400', () => {
    const t = getPublicFileUrlTool('p');
    expect(asSchema(t.inputSchema)?.safeParse({ path: 'a', ttlSeconds: 99_999 }).success).toBe(
      false,
    );
  });

  it('POSTs the path + ttl and returns the signed URL', async () => {
    let body: unknown;
    globalThis.fetch = (async (_url, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          url: 'http://localhost:8787/api/share/p1/A.html?expires=1&sig=ab',
          expiresAt: '2026-05-13T15:00:00Z',
          ttlSeconds: 3600,
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const r = (await getPublicFileUrlTool('p1').execute!(
      { path: 'A.html', ttlSeconds: 3600 },
      ctx,
    )) as string;
    expect(body).toEqual({ path: 'A.html', ttl: 3600 });
    expect(r).toMatch(/Signed URL/);
    expect(r).toMatch(/2026-05-13T15:00:00Z/);
    expect(r).toMatch(/share\/p1\/A\.html/);
  });

  it('returns friendly 404 string', async () => {
    globalThis.fetch = (async () =>
      new Response('not found', { status: 404 })) as typeof fetch;
    const r = (await getPublicFileUrlTool('p1').execute!({ path: 'missing.html' }, ctx)) as string;
    expect(r).toMatch(/file not found at missing\.html/);
  });

  it('returns friendly 503 string when SHARE_TOKEN_SECRET missing', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    const r = (await getPublicFileUrlTool('p1').execute!({ path: 'A.html' }, ctx)) as string;
    expect(r).toMatch(/share tokens are not configured/i);
  });
});
