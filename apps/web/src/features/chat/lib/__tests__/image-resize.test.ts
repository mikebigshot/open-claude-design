// image-resize — canvas decode + downsize pipeline. Tests use a fake
// {createImageBitmap, OffscreenCanvas} api so the logic is exercised
// without depending on a real browser graphics stack.

import { describe, expect, it } from 'vitest';
import {
  canResize,
  resizeAndEncode,
  MAX_EDGE,
  JPEG_QUALITY,
  type ResizeApi,
} from '../image-resize';

function makeFakeApi(opts: {
  width: number;
  height: number;
  encodedBytes?: Uint8Array;
  // optional hook to spy on resize target size
  onDraw?: (dw: number, dh: number) => void;
  convertOpts?: (opts: { type: string; quality: number }) => void;
}): ResizeApi {
  return {
    createImageBitmap: (async () => ({ width: opts.width, height: opts.height })) as never,
    OffscreenCanvas: class FakeCanvas {
      readonly w: number;
      readonly h: number;
      constructor(w: number, h: number) {
        this.w = w;
        this.h = h;
      }
      getContext(_id: '2d') {
        return {
          drawImage: (_bm: unknown, _dx: number, _dy: number, dw: number, dh: number) => {
            opts.onDraw?.(dw, dh);
          },
        };
      }
      async convertToBlob(o: { type: string; quality: number }): Promise<Blob> {
        opts.convertOpts?.(o);
        const bytes = opts.encodedBytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
        const buf = new Uint8Array(bytes).buffer as ArrayBuffer;
        // jsdom's Blob.arrayBuffer is missing in some versions — return a
        // pseudo-Blob with the method shimmed.
        return {
          type: o.type,
          size: bytes.byteLength,
          arrayBuffer: async () => buf,
        } as unknown as Blob;
      }
    },
  } as ResizeApi;
}

describe('canResize', () => {
  it('returns true when both createImageBitmap and OffscreenCanvas exist', () => {
    expect(canResize(makeFakeApi({ width: 10, height: 10 }))).toBe(true);
  });

  it('returns false when createImageBitmap is missing', () => {
    expect(canResize({} as ResizeApi)).toBe(false);
  });
});

describe('resizeAndEncode', () => {
  const tinyBytes = new Uint8Array([1, 2, 3, 4]);

  it('passes through SVG without trying to canvas-decode', async () => {
    const r = await resizeAndEncode(
      tinyBytes,
      'image/svg+xml',
      makeFakeApi({ width: 9999, height: 9999 }),
    );
    expect(r.resized).toBe(false);
    expect(r.mimeType).toBe('image/svg+xml');
    expect(r.bytes).toBe(tinyBytes);
  });

  it('passes through when the env lacks canvas APIs', async () => {
    const r = await resizeAndEncode(tinyBytes, 'image/png', {} as ResizeApi);
    expect(r.resized).toBe(false);
    expect(r.mimeType).toBe('image/png');
  });

  it('passes through tiny images that are already under MAX_EDGE', async () => {
    const r = await resizeAndEncode(
      tinyBytes,
      'image/png',
      makeFakeApi({ width: 800, height: 600 }),
    );
    expect(r.resized).toBe(false);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
  });

  it('resizes oversized images to MAX_EDGE on the longer side, preserving aspect', async () => {
    const draws: Array<{ dw: number; dh: number }> = [];
    const r = await resizeAndEncode(
      tinyBytes,
      'image/png',
      makeFakeApi({
        width: 5152, // 2× MAX_EDGE on width
        height: 2576, // 1× MAX_EDGE
        onDraw: (dw, dh) => draws.push({ dw, dh }),
        encodedBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xff]),
      }),
    );
    expect(r.resized).toBe(true);
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.width).toBe(5152);
    expect(r.height).toBe(2576);
    // Longer side hits MAX_EDGE; shorter side scales proportionally.
    expect(draws[0]?.dw).toBe(MAX_EDGE);
    expect(draws[0]?.dh).toBe(MAX_EDGE / 2);
  });

  it('uses JPEG q=0.85 for the re-encode', async () => {
    let captured: { type: string; quality: number } | undefined;
    await resizeAndEncode(
      tinyBytes,
      'image/png',
      makeFakeApi({
        width: 4000,
        height: 4000,
        convertOpts: (o) => {
          captured = o;
        },
      }),
    );
    expect(captured?.type).toBe('image/jpeg');
    expect(captured?.quality).toBe(JPEG_QUALITY);
  });

  it('passes through when createImageBitmap throws (corrupt bytes)', async () => {
    const api: ResizeApi = {
      createImageBitmap: (() => {
        throw new Error('not an image');
      }) as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      OffscreenCanvas: class {} as any,
    };
    const r = await resizeAndEncode(tinyBytes, 'image/png', api);
    expect(r.resized).toBe(false);
    expect(r.bytes).toBe(tinyBytes);
  });
});
