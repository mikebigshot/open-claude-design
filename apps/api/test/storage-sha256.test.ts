import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/storage/sha256.js';

// Pure function — no D1/R2 binding needed. Web Crypto SHA-256 → 64 hex chars (lowercase).
//
// Test vectors come from RFC 6234 / NIST SHA-256 known answers, plus
// a couple of self-consistency checks on the encoding boundary
// (Uint8Array offset / TextEncoder UTF-8 / equivalence across input shapes).

const HEX64 = /^[0-9a-f]{64}$/;

// Known SHA-256 hashes (lowercase hex):
const KNOWN = {
  empty: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  abc: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  hello: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', // "hello"
} as const;

describe('storage/sha256', () => {
  // ---------------------------------------------------------------------------
  // shape — output is 64-char lowercase hex
  // ---------------------------------------------------------------------------

  it('returns a 64-char lowercase hex string', async () => {
    const out = await sha256('anything');
    expect(out).toMatch(HEX64);
    expect(out).toBe(out.toLowerCase());
  });

  // ---------------------------------------------------------------------------
  // happy path — known vectors
  // ---------------------------------------------------------------------------

  it('hashes empty string to the canonical empty SHA-256', async () => {
    expect(await sha256('')).toBe(KNOWN.empty);
  });

  it('hashes "abc" to its NIST SHA-256 known answer', async () => {
    expect(await sha256('abc')).toBe(KNOWN.abc);
  });

  it('hashes "hello" to its known SHA-256', async () => {
    expect(await sha256('hello')).toBe(KNOWN.hello);
  });

  // ---------------------------------------------------------------------------
  // input shapes are equivalent (string / Uint8Array / ArrayBuffer)
  // ---------------------------------------------------------------------------

  it('produces identical hash for string vs Uint8Array of same UTF-8 bytes', async () => {
    const text = 'hello';
    const fromString = await sha256(text);
    const fromU8 = await sha256(new TextEncoder().encode(text));
    expect(fromU8).toBe(fromString);
  });

  it('produces identical hash for Uint8Array vs its underlying ArrayBuffer', async () => {
    const u8 = new TextEncoder().encode('roundtrip');
    const fromU8 = await sha256(u8);
    // Slice to match exactly the bytes of u8 (since the function does this internally).
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    const fromAB = await sha256(ab);
    expect(fromAB).toBe(fromU8);
  });

  // ---------------------------------------------------------------------------
  // edge: subview / offset Uint8Array (the function explicitly slices to handle this)
  // ---------------------------------------------------------------------------

  it('hashes only the visible bytes when given a Uint8Array subview (offset + length)', async () => {
    // Build an underlying buffer with leading + trailing junk; a subview pointing at the middle.
    const buf = new Uint8Array(10);
    buf.set([
      0xff, 0xff, /* slice starts here */ 0x61, 0x62, 0x63 /* slice ends here */, 0xff, 0xff, 0xff,
      0xff, 0xff,
    ]);
    const sub = new Uint8Array(buf.buffer, 2, 3); // bytes 'a', 'b', 'c' = 0x61, 0x62, 0x63
    expect(sub.byteLength).toBe(3);
    expect(await sha256(sub)).toBe(KNOWN.abc);
  });

  // ---------------------------------------------------------------------------
  // edge: UTF-8 multi-byte characters
  // ---------------------------------------------------------------------------

  it('encodes strings as UTF-8 (non-ASCII produces same hash as the UTF-8 byte sequence)', async () => {
    const emoji = 'café 🎨'; // mixes 1-byte / 2-byte / 4-byte UTF-8
    const fromString = await sha256(emoji);
    const fromU8 = await sha256(new TextEncoder().encode(emoji));
    expect(fromString).toBe(fromU8);
    expect(fromString).toMatch(HEX64);
  });

  // ---------------------------------------------------------------------------
  // edge: large input — must not truncate or throw
  // ---------------------------------------------------------------------------

  it('handles a 1 MB input without truncation (deterministic)', async () => {
    const big = new Uint8Array(1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    const a = await sha256(big);
    const b = await sha256(big);
    expect(a).toMatch(HEX64);
    expect(a).toBe(b); // deterministic
  });

  // ---------------------------------------------------------------------------
  // collision-avoidance smoke: different inputs produce different hashes
  // ---------------------------------------------------------------------------

  it('produces different hashes for different inputs', async () => {
    const a = await sha256('one');
    const b = await sha256('two');
    expect(a).not.toBe(b);
  });
});
