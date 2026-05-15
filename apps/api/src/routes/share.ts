// /api/projects/:id/share-token — mint a short-TTL signed URL for a file
// + /api/share/:projectId/:filePath — public read using the signed token.
//
// Signature is HMAC-SHA256 over `${projectId}\n${path}\n${expires}` using
// SHARE_TOKEN_SECRET. Default TTL 1 hour, caller may request up to 24h.

import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getFileRow } from '../storage/d1.js';
import { getBlob } from '../storage/r2.js';

export const shareRoute = new Hono<{ Bindings: Env & { SHARE_TOKEN_SECRET?: string } }>();

const DEFAULT_TTL_SEC = 60 * 60; // 1 hour
const MAX_TTL_SEC = 24 * 60 * 60; // 24 hours

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

shareRoute.post('/projects/:id/share-token', async (c) => {
  const projectId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { path?: unknown; ttl?: unknown };
  const path = typeof body.path === 'string' ? body.path : '';
  if (!path) return c.json({ error: 'path is required' }, 400);
  const ttlRaw = typeof body.ttl === 'number' && body.ttl > 0 ? body.ttl : DEFAULT_TTL_SEC;
  const ttl = Math.min(ttlRaw, MAX_TTL_SEC);

  const secret = c.env.SHARE_TOKEN_SECRET ?? '';
  if (!secret) return c.json({ error: 'share tokens not configured' }, 503);

  // Verify the file exists before minting a token for it.
  const row = await getFileRow(c.env.DB, projectId, path);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const expires = Math.floor(Date.now() / 1000) + ttl;
  const sig = await hmacSha256Hex(secret, `${projectId}\n${path}\n${expires}`);
  const reqUrl = new URL(c.req.url);
  const base = `${reqUrl.protocol}//${reqUrl.host}`;
  const u = new URL(`${base}/api/share/${encodeURIComponent(projectId)}/${encodeURI(path)}`);
  u.searchParams.set('expires', String(expires));
  u.searchParams.set('sig', sig);
  return c.json({
    url: u.toString(),
    expiresAt: new Date(expires * 1000).toISOString(),
    ttlSeconds: ttl,
  });
});

shareRoute.get('/share/:id/:filePath{.+}', async (c) => {
  const projectId = c.req.param('id');
  const filePath = decodeURIComponent(c.req.param('filePath'));
  const expiresRaw = c.req.query('expires') ?? '';
  const sig = c.req.query('sig') ?? '';
  const expires = parseInt(expiresRaw, 10);
  if (!Number.isInteger(expires) || expires <= 0) {
    return c.json({ error: 'invalid expires' }, 400);
  }
  if (expires < Math.floor(Date.now() / 1000)) {
    return c.json({ error: 'expired' }, 410);
  }
  const secret = c.env.SHARE_TOKEN_SECRET ?? '';
  if (!secret) return c.json({ error: 'share tokens not configured' }, 503);
  const expected = await hmacSha256Hex(secret, `${projectId}\n${filePath}\n${expires}`);
  if (!constantTimeEqual(expected, sig)) {
    return c.json({ error: 'invalid signature' }, 403);
  }
  const row = await getFileRow(c.env.DB, projectId, filePath);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const obj = await getBlob(c.env.BLOBS, projectId, row.sha256);
  if (!obj) return c.json({ error: 'blob_missing' }, 500);
  return new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': row.mime_type,
      'cache-control': 'public, max-age=300',
      'x-content-hash': row.sha256,
    },
  });
});
