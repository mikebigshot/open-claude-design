// Web Crypto SHA-256，返回 64 位 hex 字符串（小写）。
//
// 用法：const sha = await sha256(bytes); // -> "abc123..."
//
// Cloudflare Workers / 现代浏览器都自带 crypto.subtle.digest，无需 polyfill。

/**
 * 计算给定字节流的 SHA-256，返回 64 位 hex 字符串（小写）。
 *
 * 接受 Uint8Array / ArrayBuffer / 字符串（按 UTF-8 编码）。
 */
export async function sha256(input: Uint8Array | ArrayBuffer | string): Promise<string> {
  let bytes: ArrayBuffer;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input).buffer as ArrayBuffer;
  } else if (input instanceof Uint8Array) {
    // 切出对应区间（防 SharedArrayBuffer / 偏移情况）
    bytes = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength,
    ) as ArrayBuffer;
  } else {
    bytes = input;
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
