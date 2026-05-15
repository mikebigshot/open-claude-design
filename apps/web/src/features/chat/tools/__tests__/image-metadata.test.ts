// image_metadata — read width / height / has-alpha / mime from a binary
// header. Supports PNG / GIF / JPEG / WebP / BMP / SVG (text-parsed).
//
// Pure JS — no canvas / browser APIs.

import { describe, expect, it } from 'vitest';
import { parseImageMetadata } from '../image-metadata';

// Helpers for building tiny synthetic headers.
function bytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

function concat(...parts: (Uint8Array | string)[]): Uint8Array {
  const arrs = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : p));
  const total = arrs.reduce((s, a) => s + a.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}

describe('parseImageMetadata', () => {
  describe('PNG', () => {
    it('parses a 320x200 PNG header', () => {
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      // IHDR chunk: 4 bytes length, "IHDR", width(BE32), height(BE32), depth, type, ...
      const png = concat(
        bytes('89504e470d0a1a0a'),
        bytes('0000000d'), // length 13
        bytes('49484452'), // "IHDR"
        bytes('00000140'), // width = 320
        bytes('000000c8'), // height = 200
        bytes('0806000000'), // 8-bit, RGBA (color type 6 = has alpha)
      );
      const meta = parseImageMetadata(png);
      expect(meta).toMatchObject({
        mimeType: 'image/png',
        width: 320,
        height: 200,
        hasAlpha: true,
      });
    });

    it('hasAlpha=false when color type is RGB (2)', () => {
      const png = concat(
        bytes('89504e470d0a1a0a'),
        bytes('0000000d'),
        bytes('49484452'),
        bytes('00000080'), // 128
        bytes('00000080'), // 128
        bytes('0802000000'),
      );
      const meta = parseImageMetadata(png);
      expect(meta?.hasAlpha).toBe(false);
    });
  });

  describe('GIF', () => {
    it('parses GIF89a width/height (little-endian)', () => {
      // "GIF89a" + LE width=320 + LE height=200
      const gif = concat(bytes('474946383961'), bytes('4001c800'), bytes('0000000000'));
      const meta = parseImageMetadata(gif);
      expect(meta).toMatchObject({
        mimeType: 'image/gif',
        width: 320,
        height: 200,
      });
    });
  });

  describe('JPEG', () => {
    it('parses a SOF0 marker width/height (big-endian)', () => {
      // JPEG SOI ff d8, then SOF0 ff c0, segment length 11 00 0b, precision 08,
      // height(BE16) 00 c8 = 200, width(BE16) 01 40 = 320. Skip APP0 for
      // brevity — the parser walks segments until it finds an SOFn marker.
      const jpg = concat(
        bytes('ffd8'),
        bytes('ffc0'),
        bytes('000b08'), // segment length 11, precision 8
        bytes('00c8'), // height 200
        bytes('0140'), // width 320
        bytes('0301220002110103110100'),
      );
      const meta = parseImageMetadata(jpg);
      expect(meta).toMatchObject({
        mimeType: 'image/jpeg',
        width: 320,
        height: 200,
      });
    });
  });

  describe('WebP', () => {
    it('parses a VP8L lossless WebP (RIFF + WEBP)', () => {
      // RIFF length WEBP VP8L size 2f sigByte then 14-bit-1 width-1, 14-bit-1 height-1, alpha
      // Width=320 → encoded as 319 (0x13F). Height=200 → encoded as 199 (0xC7).
      // Encoding: byte0 = (W-1) & 0xFF, byte1 = (((W-1)>>8) & 0x3F) | (((H-1) & 0x03) << 6),
      //          byte2 = ((H-1) >> 2) & 0xFF, byte3 = (((H-1) >> 10) & 0x0F) | (alpha<<4) | (version<<5)
      const w = 320 - 1;
      const h = 200 - 1;
      const b0 = w & 0xff;
      const b1 = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
      const b2 = (h >> 2) & 0xff;
      const b3 = ((h >> 10) & 0x0f) | 0x10; // alpha bit = 1
      const sigByte = 0x2f;
      const webp = concat(
        bytes('52494646'), // "RIFF"
        bytes('14000000'), // chunk size
        bytes('57454250'), // "WEBP"
        bytes('56503820'), // (placeholder header — parser checks VP8L too)
      );
      // We use a VP8L test path; build it from scratch.
      const vp8lWebp = concat(
        bytes('52494646'),
        bytes('14000000'),
        bytes('57454250'),
        bytes('5650384c'), // "VP8L"
        bytes('05000000'), // VP8L sub-chunk size
        new Uint8Array([sigByte, b0, b1, b2, b3]),
      );
      const meta = parseImageMetadata(vp8lWebp);
      expect(meta).toMatchObject({
        mimeType: 'image/webp',
        width: 320,
        height: 200,
        hasAlpha: true,
      });
      void webp;
    });
  });

  describe('BMP', () => {
    it('parses a Windows BMP (LE width/height)', () => {
      const bmp = concat(
        bytes('424d'), // BM
        bytes('00000000'), // file size
        bytes('00000000'), // reserved
        bytes('36000000'), // offset
        bytes('28000000'), // DIB header size
        bytes('40010000'), // width 320
        bytes('c8000000'), // height 200
      );
      const meta = parseImageMetadata(bmp);
      expect(meta).toMatchObject({
        mimeType: 'image/bmp',
        width: 320,
        height: 200,
      });
    });
  });

  describe('SVG', () => {
    it('parses width/height attributes from SVG root', () => {
      const svg = new TextEncoder().encode(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect/></svg>',
      );
      const meta = parseImageMetadata(svg);
      expect(meta).toMatchObject({
        mimeType: 'image/svg+xml',
        width: 320,
        height: 200,
      });
    });

    it('falls back to viewBox when width/height absent', () => {
      const svg = new TextEncoder().encode(
        '<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"/>',
      );
      const meta = parseImageMetadata(svg);
      expect(meta).toMatchObject({
        mimeType: 'image/svg+xml',
        width: 800,
        height: 600,
      });
    });
  });

  describe('unknown', () => {
    it('returns null for a non-image blob', () => {
      const txt = new TextEncoder().encode('hello world');
      expect(parseImageMetadata(txt)).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(parseImageMetadata(new Uint8Array(0))).toBeNull();
    });
  });
});
