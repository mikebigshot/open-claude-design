// R2 blob 存取（sha256 内容寻址）。
//
// 路径模式：projects/{projectId}/blobs/{sha256}
//
// 内容寻址 = 同一 sha 的 blob 永远内容相同，所以：
// - PUT 时如果 R2 已经有这个 key，直接跳过（幂等）
// - GET 时设 Cache-Control: immutable, 1y
// - 跨项目同 sha 仍存两份（per-project 隔离），但项目内重复内容不重写
//
// 目前简化：只实现 putBlob / getBlob / blobExists；GC / ref count 推迟。

import type { FileMimeType } from '@open-design/contracts';

/** R2 blob 在 bucket 内的 key。 */
export function blobKey(projectId: string, sha256: string): string {
  return `projects/${projectId}/blobs/${sha256}`;
}

/**
 * 上传 blob 到 R2。
 *
 * 幂等：如果 R2 已经有这个 key，直接跳过（不重写、不报错）。
 * 同 sha 的内容必然相同（除非 SHA-256 碰撞，那是另外一个层面的问题）。
 */
export async function putBlob(
  bucket: R2Bucket,
  projectId: string,
  sha256: string,
  bytes: Uint8Array | ArrayBuffer | string,
  mimeType: FileMimeType,
): Promise<void> {
  const key = blobKey(projectId, sha256);
  const existing = await bucket.head(key);
  if (existing) return;

  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      sha256,
      uploadedAt: new Date().toISOString(),
    },
  });
}

/** 检查 R2 是否已存在该 blob。 */
export async function blobExists(
  bucket: R2Bucket,
  projectId: string,
  sha256: string,
): Promise<boolean> {
  const head = await bucket.head(blobKey(projectId, sha256));
  return head !== null;
}

/**
 * 拉 blob 字节流。返回 null 表示不存在。
 *
 * 调用方负责设置响应头 / 转 ArrayBuffer / 转字符串。
 */
export async function getBlob(
  bucket: R2Bucket,
  projectId: string,
  sha256: string,
): Promise<R2ObjectBody | null> {
  return bucket.get(blobKey(projectId, sha256));
}
