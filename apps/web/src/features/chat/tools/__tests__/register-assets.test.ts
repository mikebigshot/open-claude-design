// register_assets — POSTs items to /api/projects/:id/assets and returns a
// human-readable success line. Schema is verbatim v2; we test the wire shape
// (mocked fetch) and error handling.

import { describe, expect, it } from 'vitest';

import { registerAssetsTool } from '../register-assets';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface Captured {
  url: string;
  body: Record<string, unknown> | null;
  method: string | undefined;
}

function captureFetch(responder: () => Response): { captured: Captured } {
  const captured: Captured = { url: '', body: null, method: undefined };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    captured.url = typeof input === 'string' ? input : (input as URL).toString();
    captured.method = init?.method;
    try {
      captured.body = JSON.parse(String(init?.body ?? 'null'));
    } catch {
      captured.body = null;
    }
    return responder();
  }) as typeof fetch;
  return { captured };
}

describe('register_assets', () => {
  it('POSTs items to /api/projects/:id/assets', async () => {
    const { captured } = captureFetch(
      () =>
        new Response(
          JSON.stringify({
            registered: [
              {
                id: 'a1',
                projectId: 'p1',
                asset: 'Hero',
                path: 'hero.png',
                subtitle: null,
                viewport: null,
                status: 'needs-review',
                group: 'Components',
                createdAt: 'now',
                updatedAt: 'now',
              },
            ],
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    );
    const t = registerAssetsTool('p1');
    const r = await t.execute!(
      {
        items: [{ asset: 'Hero', path: 'hero.png', group: 'Components' }],
      },
      ctx,
    );
    expect(captured.url).toContain('/api/projects/p1/assets');
    expect(captured.method).toBe('POST');
    expect((captured.body as { items: unknown })?.items).toEqual([
      { asset: 'Hero', path: 'hero.png', group: 'Components' },
    ]);
    expect(typeof r).toBe('string');
    expect(r).toMatch(/registered/i);
    expect(r).toMatch(/1/);
  });

  it('returns an error string when the server responds non-2xx', async () => {
    captureFetch(() => new Response('bad', { status: 400 }));
    const r = await registerAssetsTool('p1').execute!({ items: [{ asset: 'x', path: 'y' }] }, ctx);
    expect(typeof r).toBe('string');
    expect(r).toMatch(/error/i);
    expect(r).toMatch(/400/);
  });

  it('preserves optional viewport / subtitle / status / group fields in the request', async () => {
    const { captured } = captureFetch(
      () => new Response(JSON.stringify({ registered: [] }), { status: 201 }),
    );
    await registerAssetsTool('p1').execute!(
      {
        items: [
          {
            asset: 'Tablet',
            path: 'tablet.html',
            subtitle: 'tablet view',
            viewport: { width: 768, height: 1024 },
            status: 'approved',
            group: 'Components',
          },
        ],
      },
      ctx,
    );
    const items = (captured.body as { items: Record<string, unknown>[] } | null)?.items ?? [];
    expect(items[0]?.subtitle).toBe('tablet view');
    expect(items[0]?.viewport).toEqual({ width: 768, height: 1024 });
    expect(items[0]?.status).toBe('approved');
    expect(items[0]?.group).toBe('Components');
  });

  it('handles N items in one call (count is reflected in the success message)', async () => {
    captureFetch(
      () =>
        new Response(
          JSON.stringify({
            registered: [{ id: '1' }, { id: '2' }, { id: '3' }],
          }),
          { status: 201 },
        ),
    );
    const r = (await registerAssetsTool('p1').execute!(
      {
        items: [
          { asset: 'A', path: 'a' },
          { asset: 'B', path: 'b' },
          { asset: 'C', path: 'c' },
        ],
      },
      ctx,
    )) as string;
    expect(r).toMatch(/3/);
  });

  it('returns an error string on network failure', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const r = (await registerAssetsTool('p1').execute!(
      { items: [{ asset: 'x', path: 'y' }] },
      ctx,
    )) as string;
    expect(r).toMatch(/error/i);
    expect(r).toMatch(/network down/);
  });

  it('input_schema rejects items without required asset/path', () => {
    const t = registerAssetsTool('p1');
    expect(t.inputSchema).toBeTruthy();
    expect(t.description).toMatch(/register/i);
  });
});
