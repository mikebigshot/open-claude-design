import { describe, expect, it } from 'vitest';
import { grepTool } from '../grep';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('grep', () => {
  it('returns hits from worker', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          matches: [{ path: 'A.jsx', line: 3, text: 'foo bar' }],
          truncated: false,
        }),
        { status: 200 },
      )) as typeof fetch;
    const r = await grepTool('p').execute!({ pattern: 'foo' }, ctx);
    expect(r).toMatchObject({ ok: true, matches: [{ path: 'A.jsx', line: 3 }] });
  });

  it('passes include filter in request body', async () => {
    let body: unknown;
    globalThis.fetch = (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, matches: [], truncated: false }), {
        status: 200,
      });
    }) as typeof fetch;
    await grepTool('p').execute!({ pattern: 'bar', include: 'src/' }, ctx);
    expect(body).toEqual({ pattern: 'bar', include: 'src/' });
  });

  it('omits include when not provided', async () => {
    let body: unknown;
    globalThis.fetch = (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, matches: [], truncated: false }), {
        status: 200,
      });
    }) as typeof fetch;
    await grepTool('p').execute!({ pattern: 'baz' }, ctx);
    expect(body).toEqual({ pattern: 'baz' });
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = (async () => new Response('bad', { status: 500 })) as typeof fetch;
    await expect(grepTool('p').execute!({ pattern: 'x' }, ctx)).rejects.toThrow('grep failed: 500');
  });
});
