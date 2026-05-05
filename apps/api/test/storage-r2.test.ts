import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { blobExists, blobKey, getBlob, putBlob } from '../src/storage/r2.js';

// Unit tests for src/storage/r2.ts. We use the real miniflare R2 binding
// (env.BLOBS) instead of mocks, mirroring the integration tests' setup.
//
// Note: miniflare R2 storage is shared across test files (`isolatedStorage:false`),
// so every test uses unique projectId + sha256 prefixes to avoid collisions.

const BLOBS = () => env.BLOBS;

// Cheap unique prefix per test run — combines an incrementing counter with a
// uuid suffix so even repeated test process runs don't collide.
let seq = 0;
function uniq(label: string): string {
  seq += 1;
  return `${label}-${seq}-${crypto.randomUUID()}`;
}

// Build a 64-char hex string (mirrors sha256 output shape) deterministically
// from a label, so tests using the same label hit the same R2 key.
function fakeSha(label: string): string {
  // Pad/repeat label hex chars to 64 chars total.
  const hex = Array.from(label)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  const padded = (hex + 'a'.repeat(64)).slice(0, 64);
  return padded;
}

describe('storage/r2', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  // ---------------------------------------------------------------------------
  // blobKey() — pure helper
  // ---------------------------------------------------------------------------

  describe('blobKey', () => {
    it('formats key as projects/{id}/blobs/{sha256}', () => {
      expect(blobKey('proj-1', 'abc123')).toBe('projects/proj-1/blobs/abc123');
    });

    it('does not URL-encode special characters (raw concatenation)', () => {
      // The function is just template concat — used as R2 key directly.
      expect(blobKey('a/b', 'sha')).toBe('projects/a/b/blobs/sha');
    });
  });

  // ---------------------------------------------------------------------------
  // putBlob — happy path
  // ---------------------------------------------------------------------------

  describe('putBlob', () => {
    it('writes bytes to R2 and they are retrievable via getBlob', async () => {
      const projectId = uniq('put-happy-proj');
      const sha = fakeSha(uniq('put-happy-sha'));
      const bytes = new TextEncoder().encode('hello-world');
      await putBlob(BLOBS(), projectId, sha, bytes, 'text/plain');

      const obj = await getBlob(BLOBS(), projectId, sha);
      expect(obj).not.toBeNull();
      const round = await obj!.text();
      expect(round).toBe('hello-world');
    });

    it('sets contentType + cacheControl httpMetadata', async () => {
      const projectId = uniq('put-meta-proj');
      const sha = fakeSha(uniq('put-meta-sha'));
      await putBlob(BLOBS(), projectId, sha, new TextEncoder().encode('x'), 'text/jsx');

      const head = await BLOBS().head(blobKey(projectId, sha));
      expect(head).not.toBeNull();
      expect(head!.httpMetadata?.contentType).toBe('text/jsx');
      expect(head!.httpMetadata?.cacheControl).toBe('public, max-age=31536000, immutable');
    });

    it('sets sha256 + uploadedAt customMetadata', async () => {
      const projectId = uniq('put-custom-proj');
      const sha = fakeSha(uniq('put-custom-sha'));
      await putBlob(BLOBS(), projectId, sha, new TextEncoder().encode('y'), 'text/plain');

      const head = await BLOBS().head(blobKey(projectId, sha));
      expect(head!.customMetadata?.sha256).toBe(sha);
      expect(head!.customMetadata?.uploadedAt).toBeTruthy();
      // ISO-8601 string check
      expect(() => new Date(head!.customMetadata!.uploadedAt!).toISOString()).not.toThrow();
    });

    it('accepts string body', async () => {
      const projectId = uniq('put-str-proj');
      const sha = fakeSha(uniq('put-str-sha'));
      await putBlob(BLOBS(), projectId, sha, 'string-body', 'text/plain');
      const obj = await getBlob(BLOBS(), projectId, sha);
      expect(await obj!.text()).toBe('string-body');
    });

    it('accepts ArrayBuffer body', async () => {
      const projectId = uniq('put-ab-proj');
      const sha = fakeSha(uniq('put-ab-sha'));
      const u8 = new TextEncoder().encode('ab-body');
      const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      await putBlob(BLOBS(), projectId, sha, ab, 'text/plain');
      const obj = await getBlob(BLOBS(), projectId, sha);
      expect(await obj!.text()).toBe('ab-body');
    });

    it('handles empty bytes (zero-length body)', async () => {
      const projectId = uniq('put-empty-proj');
      const sha = fakeSha(uniq('put-empty-sha'));
      await putBlob(BLOBS(), projectId, sha, new Uint8Array(0), 'text/plain');
      const obj = await getBlob(BLOBS(), projectId, sha);
      expect(obj).not.toBeNull();
      expect(await obj!.text()).toBe('');
      expect(obj!.size).toBe(0);
    });

    it('is idempotent: writing the same key twice does not overwrite', async () => {
      const projectId = uniq('put-idem-proj');
      const sha = fakeSha(uniq('put-idem-sha'));

      // First put.
      await putBlob(BLOBS(), projectId, sha, new TextEncoder().encode('first'), 'text/plain');
      const head1 = await BLOBS().head(blobKey(projectId, sha));
      const firstUploadedAt = head1!.customMetadata?.uploadedAt;
      expect(firstUploadedAt).toBeTruthy();

      // Wait so that any new uploadedAt would differ.
      await new Promise((r) => setTimeout(r, 10));

      // Second put with DIFFERENT bytes — should be a no-op (head returns truthy → early return).
      await putBlob(BLOBS(), projectId, sha, new TextEncoder().encode('second'), 'text/plain');

      // Bytes should still be the original — the second call short-circuits.
      const obj = await getBlob(BLOBS(), projectId, sha);
      expect(await obj!.text()).toBe('first');

      // uploadedAt customMetadata also unchanged.
      const head2 = await BLOBS().head(blobKey(projectId, sha));
      expect(head2!.customMetadata?.uploadedAt).toBe(firstUploadedAt);
    });

    it('isolates blobs per projectId (same sha across two projects → two distinct objects)', async () => {
      const sha = fakeSha(uniq('cross-proj-sha'));
      const p1 = uniq('iso-1');
      const p2 = uniq('iso-2');
      await putBlob(BLOBS(), p1, sha, new TextEncoder().encode('A'), 'text/plain');
      await putBlob(BLOBS(), p2, sha, new TextEncoder().encode('B'), 'text/plain');

      const a = await getBlob(BLOBS(), p1, sha);
      const b = await getBlob(BLOBS(), p2, sha);
      expect(await a!.text()).toBe('A');
      expect(await b!.text()).toBe('B');
    });

    it('handles large (~1 MB) bodies', async () => {
      const projectId = uniq('put-big-proj');
      const sha = fakeSha(uniq('put-big-sha'));
      const big = new Uint8Array(1024 * 1024);
      for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
      await putBlob(BLOBS(), projectId, sha, big, 'application/octet-stream' as never);
      const obj = await getBlob(BLOBS(), projectId, sha);
      expect(obj).not.toBeNull();
      expect(obj!.size).toBe(big.length);
    });
  });

  // ---------------------------------------------------------------------------
  // blobExists
  // ---------------------------------------------------------------------------

  describe('blobExists', () => {
    it('returns false for a key that was never written', async () => {
      const projectId = uniq('exists-miss-proj');
      const sha = fakeSha(uniq('exists-miss-sha'));
      expect(await blobExists(BLOBS(), projectId, sha)).toBe(false);
    });

    it('returns true after putBlob writes the same projectId+sha', async () => {
      const projectId = uniq('exists-hit-proj');
      const sha = fakeSha(uniq('exists-hit-sha'));
      await putBlob(BLOBS(), projectId, sha, new TextEncoder().encode('z'), 'text/plain');
      expect(await blobExists(BLOBS(), projectId, sha)).toBe(true);
    });

    it('does not leak across projectId (per-project isolation)', async () => {
      const sha = fakeSha(uniq('exists-cross-sha'));
      const p1 = uniq('exists-p1');
      const p2 = uniq('exists-p2');
      await putBlob(BLOBS(), p1, sha, new TextEncoder().encode('z'), 'text/plain');
      expect(await blobExists(BLOBS(), p1, sha)).toBe(true);
      expect(await blobExists(BLOBS(), p2, sha)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getBlob
  // ---------------------------------------------------------------------------

  describe('getBlob', () => {
    it('returns null for a missing key', async () => {
      const projectId = uniq('get-miss-proj');
      const sha = fakeSha(uniq('get-miss-sha'));
      const obj = await getBlob(BLOBS(), projectId, sha);
      expect(obj).toBeNull();
    });

    it('round-trips the exact bytes that were put', async () => {
      const projectId = uniq('get-round-proj');
      const sha = fakeSha(uniq('get-round-sha'));
      const bytes = new Uint8Array([0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255]);
      await putBlob(BLOBS(), projectId, sha, bytes, 'application/octet-stream' as never);
      const obj = await getBlob(BLOBS(), projectId, sha);
      expect(obj).not.toBeNull();
      const fetched = new Uint8Array(await obj!.arrayBuffer());
      expect(Array.from(fetched)).toEqual(Array.from(bytes));
    });
  });
});
