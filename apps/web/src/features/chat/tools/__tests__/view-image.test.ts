import { describe, expect, it } from 'vitest';
import { viewImageTool } from '../view-image';
const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

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
});
