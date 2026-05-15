import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { viewImageTool } from '../view-image';
import { _resetViewImageCache, getViewImageCache } from '../../lib/image-cache';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

beforeEach(() => _resetViewImageCache());
afterEach(() => _resetViewImageCache());

describe('view_image', () => {
  it('fetches the file as bytes and returns AI SDK image content with base64 data', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
    globalThis.fetch = (async () => {
      return new Response(png, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }) as typeof fetch;
    const r = (await viewImageTool('p').execute!({ path: 'a.png' }, ctx)) as
      | { ok: false; error: string }
      | { ok: true; content: { type: 'image'; mediaType: string; data: string }[] };
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content[0]?.type).toBe('image');
      expect(r.content[0]?.mediaType).toBe('image/png');
      // Base64 of [137, 80, 78, 71, 13, 10, 26, 10, 0, 0]
      expect(r.content[0]?.data).toBe('iVBORw0KGgoAAA==');
    }
  });

  it('returns not_found on 404', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const r = await viewImageTool('p').execute!({ path: 'missing.png' }, ctx);
    expect(r).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('toModelOutput is defined and converts ok result to image-data content', () => {
    const t = viewImageTool('p');
    expect((t as { toModelOutput?: unknown }).toModelOutput).toBeDefined();
    const toModelOutput = (t as { toModelOutput: (...args: unknown[]) => unknown }).toModelOutput;
    const result = toModelOutput({
      toolCallId: 't1',
      input: { path: 'a.png' },
      output: {
        ok: true as const,
        content: [{ type: 'image' as const, mediaType: 'image/png', data: 'abc123' }],
      },
    });
    expect(result).toEqual({
      type: 'content',
      value: [{ type: 'image-data', data: 'abc123', mediaType: 'image/png' }],
    });
  });

  describe('LRU cache (Phase 3 tail)', () => {
    it('repeats of the same bytes share a single cache entry keyed by sha256', async () => {
      globalThis.fetch = (async () =>
        new Response(new Uint8Array([10, 20, 30]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })) as typeof fetch;
      const t = viewImageTool('p1');
      const r1 = (await t.execute!({ path: 'a.png' }, ctx)) as {
        ok: true;
        content: { data: string }[];
      };
      const r2 = (await t.execute!({ path: 'a.png' }, ctx)) as {
        ok: true;
        content: { data: string }[];
      };
      expect(r1.content[0]?.data).toBe(r2.content[0]?.data);
      expect(getViewImageCache().size()).toBe(1);
    });

    it('different bytes → distinct cache entries', async () => {
      let toggle = true;
      globalThis.fetch = (async () => {
        const bytes = toggle ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5, 6]);
        toggle = !toggle;
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }) as typeof fetch;
      const t = viewImageTool('p1');
      await t.execute!({ path: 'a.png' }, ctx);
      await t.execute!({ path: 'b.png' }, ctx);
      expect(getViewImageCache().size()).toBe(2);
    });

    it('mediaType from cache hit matches the original response', async () => {
      globalThis.fetch = (async () =>
        new Response(new Uint8Array([5, 5, 5]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })) as typeof fetch;
      const t = viewImageTool('p1');
      const r1 = (await t.execute!({ path: 'a.jpg' }, ctx)) as {
        ok: true;
        content: { mediaType: string }[];
      };
      // Even if subsequent fetch returns different headers, cache should
      // return the original mediaType.
      globalThis.fetch = (async () =>
        new Response(new Uint8Array([5, 5, 5]), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        })) as typeof fetch;
      const r2 = (await t.execute!({ path: 'a.jpg' }, ctx)) as {
        ok: true;
        content: { mediaType: string }[];
      };
      expect(r1.content[0]?.mediaType).toBe('image/jpeg');
      expect(r2.content[0]?.mediaType).toBe('image/jpeg');
    });
  });

  describe('__pool:<key>[:index] resolution (in-memory screenshot pool)', () => {
    it('resolves an in-memory capture to AI SDK image-content without fetching', async () => {
      const { setScreenshotCaptures, _resetScreenshotPool } = await import(
        '../../lib/screenshot-pool'
      );
      _resetScreenshotPool();
      // Network MUST NOT be hit for pool refs — fail loudly if it is.
      globalThis.fetch = (async () => {
        throw new Error('fetch should not be called for __pool: refs');
      }) as typeof fetch;
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      setScreenshotCaptures('frames', [
        new Blob([new Uint8Array(png).buffer as ArrayBuffer], { type: 'image/png' }),
        new Blob([new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer], { type: 'image/png' }),
      ]);
      const r0 = (await viewImageTool('p').execute!({ path: '__pool:frames:0' }, ctx)) as {
        ok: true;
        content: { mediaType: string; data: string }[];
      };
      expect(r0.ok).toBe(true);
      expect(r0.content[0]?.mediaType).toBe('image/png');
      expect(r0.content[0]?.data.length).toBeGreaterThan(0);

      const r1 = (await viewImageTool('p').execute!({ path: '__pool:frames:1' }, ctx)) as {
        ok: true;
        content: { mediaType: string }[];
      };
      expect(r1.ok).toBe(true);

      // `__pool:<key>` (no index) defaults to index 0.
      const rD = (await viewImageTool('p').execute!({ path: '__pool:frames' }, ctx)) as {
        ok: true;
        content: { data: string }[];
      };
      expect(rD.ok).toBe(true);
      expect(rD.content[0]?.data).toBe(r0.content[0]?.data);
    });

    it('returns not_found for an unknown pool key or out-of-range index', async () => {
      const { _resetScreenshotPool } = await import('../../lib/screenshot-pool');
      _resetScreenshotPool();
      globalThis.fetch = (async () => {
        throw new Error('fetch should not be called for __pool: refs');
      }) as typeof fetch;
      expect(await viewImageTool('p').execute!({ path: '__pool:missing:0' }, ctx)).toMatchObject({
        ok: false,
        error: 'not_found',
      });
    });
  });
});
