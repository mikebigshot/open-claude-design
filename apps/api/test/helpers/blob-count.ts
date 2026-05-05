import { env } from 'cloudflare:test';

/**
 * Count rows in the blobs table. Used by routes-files dedupe assertions
 * (sha256 内容寻址 = 同 content 多次 PUT 应只产 1 行 blob).
 */
export async function getBlobCount(): Promise<number> {
  const result = await env.DB.prepare('SELECT COUNT(*) as count FROM blobs').first<{
    count: number;
  }>();
  return result?.count ?? 0;
}
