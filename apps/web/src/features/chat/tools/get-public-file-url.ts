// get_public_file_url — mint a short-TTL signed URL for a project file so
// the user (or an external endpoint) can fetch it without going through
// the project's auth boundary. Worker side performs HMAC-SHA256 over
// (projectId, path, expires) using SHARE_TOKEN_SECRET; the returned URL
// validates itself via the `sig=` query param.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function getPublicFileUrlTool(projectId: string) {
  return tool({
    description:
      'Mint a short-lived signed public URL for a project file. Pass to the user when they need to share or open the file outside the chat. Default TTL is 1 hour; pass `ttlSeconds` up to 86400 (24h) to extend.',
    inputSchema: z
      .object({
        path: z.string().min(1).describe('File path relative to project root.'),
        ttlSeconds: z
          .number()
          .int()
          .min(60)
          .max(86_400)
          .optional()
          .describe('How long the URL should remain valid. Default: 3600 (1 hour).'),
      })
      .strict(),
    execute: async ({ path, ttlSeconds }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/share-token`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, ...(ttlSeconds ? { ttl: ttlSeconds } : {}) }),
        signal: abortSignal,
      });
      if (!res.ok) {
        if (res.status === 404) return `Error: file not found at ${path}`;
        if (res.status === 503) {
          return 'Error: share tokens are not configured on this deployment (SHARE_TOKEN_SECRET missing).';
        }
        return `Error: get_public_file_url failed (HTTP ${res.status})`;
      }
      const json = (await res.json()) as {
        url: string;
        expiresAt: string;
        ttlSeconds: number;
      };
      return `Signed URL (expires ${json.expiresAt}): ${json.url}`;
    },
  });
}
