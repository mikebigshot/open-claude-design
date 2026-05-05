import { afterEach, describe, expect, it, vi } from 'vitest';
import { strReplaceBasedEditTool } from '../str-replace-based-edit-tool';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

afterEach(() => vi.restoreAllMocks());

function mockFetch(routes: Record<string, (init: RequestInit) => Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [pat, h] of Object.entries(routes)) if (url.endsWith(pat)) return h(init ?? {});
    return new Response('not mocked: ' + url, { status: 599 });
  }) as typeof fetch;
}

describe('str_replace_based_edit_tool', () => {
  it('replaces a unique occurrence and writes the new content', async () => {
    let putBody: { content: string } | undefined;
    mockFetch({
      '/files/A.jsx': (init) => {
        if (init.method === 'GET' || !init.method) {
          return new Response('hello world\nbye world', { status: 200 });
        }
        putBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ sha256: 'aaa', size: 7 }), { status: 200 });
      },
    });

    const t = strReplaceBasedEditTool('p1');
    const r = await t.execute!({ path: 'A.jsx', old_str: 'hello', new_str: 'HI' }, ctx);
    expect(r).toEqual({ ok: true, path: 'A.jsx', sha256: 'aaa', size: 7 });
    expect(putBody?.content).toBe('HI world\nbye world');
  });

  it('errors if old_str matches multiple times', async () => {
    mockFetch({
      '/files/A.jsx': () => new Response('foo bar foo', { status: 200 }),
    });
    const t = strReplaceBasedEditTool('p1');
    const r = await t.execute!({ path: 'A.jsx', old_str: 'foo', new_str: 'baz' }, ctx);
    expect(r).toMatchObject({ ok: false, error: 'multiple_matches', count: 2 });
  });

  it('errors if old_str not found', async () => {
    mockFetch({
      '/files/A.jsx': () => new Response('nothing matches', { status: 200 }),
    });
    const t = strReplaceBasedEditTool('p1');
    const r = await t.execute!({ path: 'A.jsx', old_str: 'XYZ', new_str: 'abc' }, ctx);
    expect(r).toMatchObject({ ok: false, error: 'not_found' });
  });
});
