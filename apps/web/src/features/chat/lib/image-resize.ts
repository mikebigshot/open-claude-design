// image-resize — canvas decode + downsize + JPEG re-encode for view_image.
//
// In a browser env: createImageBitmap → OffscreenCanvas at max(width,
// height) ≤ MAX_EDGE → toBlob('image/jpeg', JPEG_QUALITY). In jsdom (or any
// env without the required APIs): passthrough — return the original bytes
// and mime intact. Tests can DI a fake encoder via `resizeAndEncodeWith`.
//
// The threshold + quality match official: 2576px max edge, JPEG q=0.85.

export const MAX_EDGE = 2576;
export const JPEG_QUALITY = 0.85;

/** Result of a resize pass; `resized` is false when we passed through. */
export interface ResizeResult {
  bytes: Uint8Array;
  mimeType: string;
  /** Original (decoded) width — undefined if we couldn't decode. */
  width?: number;
  /** Original (decoded) height — undefined if we couldn't decode. */
  height?: number;
  resized: boolean;
}

/** Browser-API surface this module needs; matches global names so impl
 *  can be `globalThis` in production. Tests can DI a stub. */
export interface ResizeApi {
  createImageBitmap?: typeof globalThis.createImageBitmap;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OffscreenCanvas?: any;
}

/** Check whether the env supports the resize pipeline. */
export function canResize(api: ResizeApi = globalThis as ResizeApi): boolean {
  return (
    typeof api.createImageBitmap === 'function' && typeof api.OffscreenCanvas === 'function'
  );
}

/**
 * Resize bytes to ≤ MAX_EDGE on the longer side and JPEG-encode at
 * quality 0.85. SVG and tiny images are passed through unmodified.
 *
 * `api` defaults to globalThis (real browser). Tests pass a stub.
 */
export async function resizeAndEncode(
  bytes: Uint8Array,
  mimeType: string,
  api: ResizeApi = globalThis as ResizeApi,
): Promise<ResizeResult> {
  // SVG stays as text — don't try to canvas-decode it.
  if (mimeType === 'image/svg+xml' || mimeType.startsWith('text/')) {
    return { bytes, mimeType, resized: false };
  }
  if (!canResize(api)) {
    return { bytes, mimeType, resized: false };
  }
  try {
    const buf = new Uint8Array(bytes).buffer as ArrayBuffer;
    const blob = new Blob([buf], { type: mimeType });
    const bitmap = await api.createImageBitmap!(blob);
    const w = bitmap.width;
    const h = bitmap.height;
    if (w === 0 || h === 0) {
      return { bytes, mimeType, resized: false };
    }
    const longer = Math.max(w, h);
    // Tiny / already-small images: skip the re-encode (it would inflate
    // them) and just pass through.
    if (longer <= MAX_EDGE) {
      return { bytes, mimeType, width: w, height: h, resized: false };
    }
    const scale = MAX_EDGE / longer;
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));
    const OffscreenCanvasCtor = api.OffscreenCanvas as {
      new (w: number, h: number): {
        getContext(id: '2d'): {
          drawImage(bm: unknown, dx: number, dy: number, dw: number, dh: number): void;
        } | null;
        convertToBlob(opts: { type: string; quality: number }): Promise<Blob>;
      };
    };
    const canvas = new OffscreenCanvasCtor(targetW, targetH);
    const cx = canvas.getContext('2d');
    if (!cx) return { bytes, mimeType, width: w, height: h, resized: false };
    cx.drawImage(bitmap, 0, 0, targetW, targetH);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    const outBytes = new Uint8Array(await out.arrayBuffer());
    return { bytes: outBytes, mimeType: 'image/jpeg', width: w, height: h, resized: true };
  } catch {
    // Decode / encode failed — fall through to passthrough. The original
    // bytes are still valid for display in the LLM.
    return { bytes, mimeType, resized: false };
  }
}
