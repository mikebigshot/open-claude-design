// 薄 fetch wrapper —— 所有调 /api/* 的代码经此一道
// 默认 base URL 取 VITE_API_BASE，本地用 vite proxy 把 /api 转 8787
// V2 加 cookie 时 credentials: 'include' 已就位。

export interface ApiErrorBody {
  message?: string;
  code?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: ApiErrorBody | null;

  constructor(status: number, message: string, body: ApiErrorBody | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const BASE_URL = (import.meta.env.VITE_API_BASE ?? '') as string;

export function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!BASE_URL) return path;
  // 防止 //api 之类的拼接
  const trimmedBase = BASE_URL.replace(/\/+$/, '');
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

/**
 * Extra options layered on top of {@link RequestInit}. Use these when reading
 * file content from the worker — by default the wrapper auto-parses
 * `application/json` responses, which round-trips JSON files (loses original
 * indentation, key order, trailing newline) and mangles binary bytes when
 * the mime is wrong. `expectText` returns the raw response body as a string,
 * `expectArrayBuffer` returns it as an `ArrayBuffer` for binary content.
 */
export interface ApiOptions extends RequestInit {
  /** Return raw text instead of auto-parsing JSON. Mutually exclusive with `expectArrayBuffer`. */
  expectText?: boolean;
  /** Return raw bytes (no decoding). Mutually exclusive with `expectText`. */
  expectArrayBuffer?: boolean;
}

/**
 * JSON-aware fetch wrapper。
 * - 自动 Content-Type
 * - body 是 plain object 时自动 JSON.stringify
 * - 响应非 2xx 抛 ApiError
 * - 响应是 JSON 自动 parse；空 body 返回 undefined as T
 * - `expectText: true` → 跳过 JSON parse，返 raw text（适合 .json 源文件 round-trip）
 * - `expectArrayBuffer: true` → 返 ArrayBuffer（适合 image/* 等二进制）
 */
export async function api<T = unknown>(path: string, init: ApiOptions = {}): Promise<T> {
  const url = buildUrl(path);
  const { expectText, expectArrayBuffer, ...fetchInit } = init;

  // headers
  const headers = new Headers(fetchInit.headers);
  let body = fetchInit.body;

  if (
    body !== undefined &&
    body !== null &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    typeof body !== 'string'
  ) {
    body = JSON.stringify(body);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const response = await fetch(url, {
    ...fetchInit,
    headers,
    body,
    credentials: fetchInit.credentials ?? 'include',
  });

  // 204 / 205：无 body
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    let parsed: ApiErrorBody | null = null;
    if (isJson) {
      try {
        parsed = (await response.json()) as ApiErrorBody;
      } catch {
        parsed = null;
      }
    } else {
      try {
        const text = await response.text();
        parsed = text ? { message: text } : null;
      } catch {
        parsed = null;
      }
    }
    const message =
      parsed?.message ?? `HTTP ${response.status} ${response.statusText || 'error'} on ${path}`;
    throw new ApiError(response.status, message, parsed);
  }

  // Caller asked for raw bytes — bypass any decoding (binary safe).
  if (expectArrayBuffer) {
    return (await response.arrayBuffer()) as unknown as T;
  }

  // Caller asked for raw text — bypass JSON parse so original formatting
  // (indentation / key order / trailing newline) survives round-trip.
  if (expectText) {
    return (await response.text()) as unknown as T;
  }

  if (isJson) {
    return (await response.json()) as T;
  }

  // 非 JSON 响应（按理 V1 都是 JSON 或 SSE，SSE 走 sse-client，不走这）
  return (await response.text()) as unknown as T;
}
