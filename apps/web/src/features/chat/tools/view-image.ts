// view_image — read an image file from the project, return it as an
// AI-SDK image-content block. Backed by an LRU cache keyed by the bytes'
// sha256 so the same image doesn't get re-decoded/re-base64'd on every
// turn that re-emits its tool_result.
//
// Canvas decode + 2576px downsize + JPEG q=0.85 re-encode runs when the
// browser supports OffscreenCanvas + createImageBitmap; jsdom falls
// through to passthrough so tests aren't blocked.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';
import { getViewImageCache } from '../lib/image-cache.js';
import { resizeAndEncode } from '../lib/image-resize.js';
import { resolveCrossProjectPath } from '../lib/cross-project-path.js';
import { getScreenshotCapture, getScreenshotCaptureCount } from '../lib/screenshot-pool.js';

type ViewImageInput = { path: string };
type ViewImageOutput =
  | { ok: false; error: 'not_found' }
  | { ok: true; content: { type: 'image'; mediaType: string; data: string }[] };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle: SubtleCrypto | undefined =
    typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : undefined;
  if (!subtle) {
    // Fallback: hash by content-length + first/last bytes. Coarse but
    // adequate for cache keying when WebCrypto isn't available (very rare).
    return `len${bytes.byteLength}-${bytes[0] ?? 0}-${bytes[bytes.byteLength - 1] ?? 0}`;
  }
  // Wrap in a fresh ArrayBuffer to avoid SharedArrayBuffer typing issues.
  const buf = new Uint8Array(bytes).buffer;
  const digest = await subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function viewImageTool(projectId: string) {
  return tool<ViewImageInput, ViewImageOutput>({
    description:
      'Read an image file in the project so you can see its contents in the next turn. Use for screenshots / mockups / reference images. Cached by content hash — repeated reads of the same image are free.',
    inputSchema: z.object({ path: z.string().describe('Image file path.') }),
    execute: async ({ path }, { abortSignal }) => {
      // `__pool:<key>:<index>` (or `__pool:<key>` for index 0) resolves a
      // capture stashed by save_screenshot's in-memory mode without a disk
      // round-trip. Pool entries are Blobs — pull the bytes, run the same
      // resize / cache pipeline as disk-backed reads.
      if (path.startsWith('__pool:')) {
        const rest = path.slice('__pool:'.length);
        const colon = rest.lastIndexOf(':');
        const key = colon >= 0 ? rest.slice(0, colon) : rest;
        const idx = colon >= 0 ? Number(rest.slice(colon + 1)) : 0;
        if (!key || (colon >= 0 && (!Number.isFinite(idx) || idx < 0))) {
          return { ok: false as const, error: 'not_found' as const };
        }
        const count = getScreenshotCaptureCount(key);
        if (count === 0 || idx >= count) {
          return { ok: false as const, error: 'not_found' as const };
        }
        const blob = getScreenshotCapture(key, idx);
        if (!blob) return { ok: false as const, error: 'not_found' as const };
        const mediaType = blob.type || 'image/png';
        // jsdom 25's Blob doesn't expose arrayBuffer(), so go through
        // Response — same path the real browser uses but jsdom-safe.
        const buf = new Uint8Array(await new Response(blob).arrayBuffer());
        const cacheKey = `__pool:${key}:${idx}`;
        const cache = getViewImageCache();
        const hit = cache.get(cacheKey);
        if (hit) {
          return {
            ok: true as const,
            content: [{ type: 'image' as const, mediaType: hit.mediaType, data: hit.base64 }],
          };
        }
        const resized = await resizeAndEncode(buf, mediaType);
        const data = bytesToBase64(resized.bytes);
        cache.set(cacheKey, {
          base64: data,
          mediaType: resized.mimeType,
          originalBytes: buf.byteLength,
          encodedBytes: data.length,
        });
        return {
          ok: true as const,
          content: [{ type: 'image' as const, mediaType: resized.mimeType, data }],
        };
      }

      const ref = resolveCrossProjectPath(projectId, path);
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(ref.projectId)}/files/${encodeURI(ref.relPath)}`,
      );
      const res = await fetch(url, { signal: abortSignal });
      if (res.status === 404) return { ok: false as const, error: 'not_found' as const };
      if (!res.ok) throw new Error(`view_image failed: ${res.status}`);
      const mediaType = res.headers.get('content-type') ?? 'application/octet-stream';
      const buf = new Uint8Array(await res.arrayBuffer());

      const key = await sha256Hex(buf);
      const cache = getViewImageCache();
      const hit = cache.get(key);
      if (hit) {
        return {
          ok: true as const,
          content: [{ type: 'image' as const, mediaType: hit.mediaType, data: hit.base64 }],
        };
      }

      // Canvas decode + 2576px max edge + JPEG q=0.85 re-encode runs in
      // browsers; jsdom / Node pass through unchanged.
      const resized = await resizeAndEncode(buf, mediaType);
      const data = bytesToBase64(resized.bytes);
      cache.set(key, {
        base64: data,
        mediaType: resized.mimeType,
        originalBytes: buf.byteLength,
        encodedBytes: data.length,
      });
      return {
        ok: true as const,
        content: [{ type: 'image' as const, mediaType: resized.mimeType, data }],
      };
    },
    // Emit proper SDK image-data content so the LLM sees the image visually,
    // not a JSON blob with a base64 string.
    toModelOutput: ({ output }) => {
      const o = output as
        | { ok: false; error: string }
        | { ok: true; content: { type: 'image'; mediaType: string; data: string }[] };
      if (!o.ok) {
        return { type: 'json', value: o as never };
      }
      return {
        type: 'content',
        value: o.content.map((part) => ({
          type: 'image-data' as const,
          data: part.data,
          mediaType: part.mediaType,
        })),
      };
    },
  });
}
