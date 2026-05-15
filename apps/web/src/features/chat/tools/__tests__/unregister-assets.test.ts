// unregister_assets — DELETE /api/projects/:id/assets wrapper.

import { describe, expect, it } from 'vitest';
import { unregisterAssetsTool } from '../unregister-assets';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('unregister_assets', () => {
  it('rejects empty names array', () => {
    const t = unregisterAssetsTool('p');
    expect(asSchema(t.inputSchema)?.safeParse({ names: [] }).success).toBe(false);
  });

  it('DELETEs with the names body', async () => {
    let calledUrl = '';
    let method = '';
    let body: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      method = init?.method ?? '';
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, deleted: 2 }), { status: 200 });
    }) as typeof fetch;

    const r = (await unregisterAssetsTool('p1').execute!({ names: ['a', 'b'] }, ctx)) as string;
    expect(calledUrl).toBe('/api/projects/p1/assets');
    expect(method).toBe('DELETE');
    expect(body).toEqual({ names: ['a', 'b'] });
    expect(r).toMatch(/Unregistered 2 assets/);
  });

  it('reports "0 assets" friendly when nothing matched', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, deleted: 0 }), { status: 200 })) as typeof fetch;
    const r = (await unregisterAssetsTool('p1').execute!({ names: ['x'] }, ctx)) as string;
    expect(r).toMatch(/Unregistered 0 assets/);
  });

  it('returns error string on non-ok', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    const r = (await unregisterAssetsTool('p1').execute!({ names: ['x'] }, ctx)) as string;
    expect(r).toMatch(/error/i);
  });
});
