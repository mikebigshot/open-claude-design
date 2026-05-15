// image_metadata — read mime / width / height / hasAlpha from a binary
// header. Supports PNG, GIF, JPEG, WebP, BMP, SVG (text-parsed).
//
// Pure JS, no canvas / browser APIs — pluggable into both tool execute()
// and test environments.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export interface ImageMetadata {
  mimeType: string;
  width: number;
  height: number;
  hasAlpha?: boolean;
}

function be16(b: Uint8Array, off: number): number {
  return (b[off]! << 8) | b[off + 1]!;
}
function be32(b: Uint8Array, off: number): number {
  return (b[off]! * 0x1000000) + ((b[off + 1]! << 16) >>> 0) + (b[off + 2]! << 8) + b[off + 3]!;
}
function le16(b: Uint8Array, off: number): number {
  return b[off]! | (b[off + 1]! << 8);
}
function le32(b: Uint8Array, off: number): number {
  return b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! * 0x1000000);
}

function startsWith(b: Uint8Array, sig: number[]): boolean {
  if (b.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false;
  return true;
}

function parsePNG(b: Uint8Array): ImageMetadata | null {
  // 8-byte signature + IHDR chunk at offset 16
  if (b.length < 24) return null;
  if (!startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  // IHDR starts at offset 12 (sig=8, length=4) after the chunk type "IHDR" at 12-16.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const width = be32(b, 16);
  const height = be32(b, 20);
  const colorType = b[25]!;
  // PNG color types: 0=gray, 2=RGB, 3=palette, 4=gray+alpha, 6=RGBA. Alpha if & 4.
  const hasAlpha = (colorType & 4) !== 0 || colorType === 3 /* palette may carry tRNS */;
  return { mimeType: 'image/png', width, height, hasAlpha };
}

function parseGIF(b: Uint8Array): ImageMetadata | null {
  if (b.length < 10) return null;
  if (!startsWith(b, [0x47, 0x49, 0x46, 0x38])) return null; // "GIF8"
  if (b[4] !== 0x39 && b[4] !== 0x37) return null;
  if (b[5] !== 0x61) return null;
  const width = le16(b, 6);
  const height = le16(b, 8);
  return { mimeType: 'image/gif', width, height };
}

function parseJPEG(b: Uint8Array): ImageMetadata | null {
  if (b.length < 4) return null;
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  // Walk segments looking for SOF0/SOF2/SOFn marker.
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0xd9) return null;
    // SOFn markers: c0-c3, c5-c7, c9-cb, cd-cf (excluding c4/c8/cc)
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      const height = be16(b, i + 5);
      const width = be16(b, i + 7);
      return { mimeType: 'image/jpeg', width, height };
    }
    // Skip segment: marker(2) + length(2) → length includes the 2 length bytes.
    const segLen = be16(b, i + 2);
    if (segLen < 2) return null;
    i += 2 + segLen;
  }
  return null;
}

function parseWebP(b: Uint8Array): ImageMetadata | null {
  if (b.length < 16) return null;
  if (!startsWith(b, [0x52, 0x49, 0x46, 0x46])) return null; // "RIFF"
  if (b[8] !== 0x57 || b[9] !== 0x45 || b[10] !== 0x42 || b[11] !== 0x50) return null; // "WEBP"
  // VP8 vs VP8L vs VP8X
  const fourCC = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (fourCC === 'VP8 ') {
    // Lossy. Width/height in 4 bytes after 10-byte VP8 frame header at offset 26 + flags.
    const width = le16(b, 26) & 0x3fff;
    const height = le16(b, 28) & 0x3fff;
    return { mimeType: 'image/webp', width, height };
  }
  if (fourCC === 'VP8L') {
    // Lossless. Signature byte at offset 20, then 28-bit packed: width-1 (14b) + height-1 (14b)
    // + alpha (1b) + version (3b).
    if (b[20] !== 0x2f) return null;
    const b0 = b[21]!,
      b1 = b[22]!,
      b2 = b[23]!,
      b3 = b[24]!;
    const widthMinus1 = b0 | ((b1 & 0x3f) << 8);
    const heightMinus1 = ((b1 >> 6) & 0x03) | (b2 << 2) | ((b3 & 0x0f) << 10);
    const hasAlpha = (b3 & 0x10) !== 0;
    return { mimeType: 'image/webp', width: widthMinus1 + 1, height: heightMinus1 + 1, hasAlpha };
  }
  if (fourCC === 'VP8X') {
    // Extended. Width/height (1-based, 24-bit LE) at offsets 24/27.
    const width = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
    const height = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
    const hasAlpha = (b[20]! & 0x10) !== 0;
    return { mimeType: 'image/webp', width, height, hasAlpha };
  }
  return null;
}

function parseBMP(b: Uint8Array): ImageMetadata | null {
  if (b.length < 26) return null;
  if (b[0] !== 0x42 || b[1] !== 0x4d) return null; // "BM"
  const width = le32(b, 18);
  const height = le32(b, 22);
  return { mimeType: 'image/bmp', width: width, height: Math.abs(height) };
}

function parseSVG(b: Uint8Array): ImageMetadata | null {
  // Cheap: decode head bytes, look for "<svg" then width/height/viewBox attrs.
  const text = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 2048)));
  if (!/<svg[\s>]/i.test(text)) return null;
  const widthMatch = text.match(/<svg[^>]*\swidth=["']?(\d+(?:\.\d+)?)/i);
  const heightMatch = text.match(/<svg[^>]*\sheight=["']?(\d+(?:\.\d+)?)/i);
  if (widthMatch && heightMatch) {
    return {
      mimeType: 'image/svg+xml',
      width: Math.round(Number(widthMatch[1])),
      height: Math.round(Number(heightMatch[1])),
    };
  }
  const viewBoxMatch = text.match(/<svg[^>]*\sviewBox=["']?\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)/i);
  if (viewBoxMatch) {
    return {
      mimeType: 'image/svg+xml',
      width: Math.round(Number(viewBoxMatch[3])),
      height: Math.round(Number(viewBoxMatch[4])),
    };
  }
  return null;
}

export function parseImageMetadata(bytes: Uint8Array): ImageMetadata | null {
  if (bytes.length === 0) return null;
  return (
    parsePNG(bytes) ??
    parseGIF(bytes) ??
    parseJPEG(bytes) ??
    parseWebP(bytes) ??
    parseBMP(bytes) ??
    parseSVG(bytes)
  );
}

export function imageMetadataTool(projectId: string) {
  return tool({
    description:
      'Read width / height / mime / alpha-channel from an image file in the project, without loading the full image into context. Supports PNG, GIF, JPEG, WebP, BMP, and SVG.',
    inputSchema: z
      .object({
        path: z.string().min(1).describe('Image file path relative to project root.'),
      })
      .strict(),
    execute: async ({ path }, { abortSignal }) => {
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
      );
      let res: Response;
      try {
        res = await fetch(url, { signal: abortSignal });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: image_metadata fetch failed (${msg})`;
      }
      if (res.status === 404) return `Error: image not found (404) at path: ${path}`;
      if (!res.ok) return `Error: image_metadata failed (HTTP ${res.status})`;

      const buf = new Uint8Array(await res.arrayBuffer());
      const meta = parseImageMetadata(buf);
      if (!meta) {
        return `Error: unrecognized image format at ${path} (${buf.byteLength} bytes).`;
      }
      const alpha = meta.hasAlpha !== undefined ? ` alpha=${meta.hasAlpha ? 'yes' : 'no'}` : '';
      return `${path}: ${meta.mimeType} ${meta.width}×${meta.height}${alpha}`;
    },
  });
}
