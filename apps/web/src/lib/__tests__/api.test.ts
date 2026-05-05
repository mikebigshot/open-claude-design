// api() — fetch wrapper unit tests.
//
// We mock globalThis.fetch and verify:
//   - URL building (BASE_URL prefix, leading slash normalization, absolute URL passthrough)
//   - Auto JSON serialization for plain object body
//   - Header injection (Content-Type for JSON body, default Accept)
//   - credentials: 'include' default
//   - 204/205 → undefined
//   - non-2xx JSON → ApiError with parsed body + .message preference
//   - non-2xx text → ApiError with text wrapped as { message }
//   - 2xx JSON → parsed
//   - 2xx text → returned as string
//   - FormData / Blob / string body → not stringified, no auto Content-Type

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api';

interface FetchCall {
  input: string | URL | Request;
  init: RequestInit | undefined;
}

const calls: FetchCall[] = [];

function mockFetch(response: Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: input as string, init });
    return response;
  }) as typeof fetch;
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api()', () => {
  describe('URL building', () => {
    it('uses path as-is when no BASE_URL set (default in test env)', async () => {
      mockFetch(new Response(null, { status: 204 }));
      await api('/api/projects');
      expect(calls[0]!.input).toBe('/api/projects');
    });

    it('passes through fully-qualified http(s) URLs unchanged', async () => {
      mockFetch(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await api('https://example.com/foo');
      expect(calls[0]!.input).toBe('https://example.com/foo');
    });
  });

  describe('headers and body', () => {
    it('JSON-stringifies plain object body and sets Content-Type', async () => {
      mockFetch(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await api('/api/x', { method: 'POST', body: { a: 1 } as unknown as BodyInit });
      const init = calls[0]!.init!;
      expect(init.body).toBe(JSON.stringify({ a: 1 }));
      const headers = new Headers(init.headers);
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('accept')).toBe('application/json');
    });

    it('does NOT stringify FormData body', async () => {
      mockFetch(new Response(null, { status: 204 }));
      const fd = new FormData();
      fd.append('k', 'v');
      await api('/api/up', { method: 'POST', body: fd });
      expect(calls[0]!.init!.body).toBe(fd);
      const headers = new Headers(calls[0]!.init!.headers);
      // Content-Type should not be force-set; FormData lets browser pick boundary
      expect(headers.get('content-type')).toBeNull();
    });

    it('does NOT stringify string body', async () => {
      mockFetch(new Response(null, { status: 204 }));
      await api('/api/x', { method: 'POST', body: 'raw text' });
      expect(calls[0]!.init!.body).toBe('raw text');
    });

    it('respects an existing Content-Type header on plain object body', async () => {
      mockFetch(new Response(null, { status: 204 }));
      await api('/api/x', {
        method: 'POST',
        body: { a: 1 } as unknown as BodyInit,
        headers: { 'Content-Type': 'application/vnd.custom+json' },
      });
      const headers = new Headers(calls[0]!.init!.headers);
      expect(headers.get('content-type')).toBe('application/vnd.custom+json');
    });

    it('defaults credentials to "include"', async () => {
      mockFetch(new Response(null, { status: 204 }));
      await api('/api/x');
      expect(calls[0]!.init!.credentials).toBe('include');
    });

    it('honors caller-provided credentials override', async () => {
      mockFetch(new Response(null, { status: 204 }));
      await api('/api/x', { credentials: 'omit' });
      expect(calls[0]!.init!.credentials).toBe('omit');
    });
  });

  describe('response parsing', () => {
    it('returns undefined for 204', async () => {
      mockFetch(new Response(null, { status: 204 }));
      const r = await api('/api/x');
      expect(r).toBeUndefined();
    });

    it('returns undefined for 205', async () => {
      mockFetch(new Response(null, { status: 205 }));
      const r = await api('/api/x');
      expect(r).toBeUndefined();
    });

    it('parses JSON response on 2xx with application/json content-type', async () => {
      mockFetch(
        new Response(JSON.stringify({ hello: 'world' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const r = await api<{ hello: string }>('/api/x');
      expect(r).toEqual({ hello: 'world' });
    });

    it('returns text on 2xx with non-JSON content-type', async () => {
      mockFetch(
        new Response('plain string body', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
      const r = await api<string>('/api/x');
      expect(r).toBe('plain string body');
    });

    it('honors expectText: returns raw body even for application/json content-type', async () => {
      // P1-9 regression guard: caller wants to preserve original .json
      // formatting (indent / key order / trailing newline). Without the
      // flag, api() auto-parses + re-stringifies and the bytes change.
      const original = '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n';
      mockFetch(
        new Response(original, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const r = await api<string>('/api/x', { expectText: true });
      expect(r).toBe(original);
    });

    it('honors expectArrayBuffer: returns raw bytes for binary mime', async () => {
      // P1-9 regression guard: binary bytes (e.g. PNG magic 0x89) survive
      // round-trip — auto text decode would replace 0x89 with 0xEF 0xBF 0xBD.
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      mockFetch(
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
      const r = await api<ArrayBuffer>('/api/x', { expectArrayBuffer: true });
      expect(r).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(r))).toEqual(Array.from(bytes));
    });

    it('does not pass expectText / expectArrayBuffer through to fetch init', async () => {
      // The wrapper must strip our custom keys from the RequestInit object
      // so they don't show up on the fetch call (would be ignored but
      // pollutes the contract).
      mockFetch(new Response('hi', { status: 200, headers: { 'content-type': 'text/plain' } }));
      await api('/api/x', { expectText: true, method: 'GET' });
      const init = calls[0]!.init!;
      expect(init).not.toHaveProperty('expectText');
      expect(init).not.toHaveProperty('expectArrayBuffer');
      expect(init.method).toBe('GET');
    });
  });

  describe('error handling', () => {
    it('throws ApiError with parsed JSON body on 4xx', async () => {
      mockFetch(
        new Response(JSON.stringify({ message: 'Not found', code: 'project_missing' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'application/json' },
        }),
      );
      let err: unknown;
      try {
        await api('/api/missing');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.message).toBe('Not found');
      expect(apiErr.body).toEqual({ message: 'Not found', code: 'project_missing' });
    });

    it('falls back to "HTTP <status> <statusText> on <path>" when body has no message', async () => {
      mockFetch(
        new Response(JSON.stringify({ code: 'oops' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'application/json' },
        }),
      );
      let err: ApiError | null = null;
      try {
        await api('/api/x');
      } catch (e) {
        err = e as ApiError;
      }
      expect(err?.message).toBe('HTTP 500 Internal Server Error on /api/x');
    });

    it('wraps non-JSON error body as { message: <text> }', async () => {
      mockFetch(
        new Response('boom', {
          status: 500,
          statusText: 'oops',
          headers: { 'content-type': 'text/plain' },
        }),
      );
      let err: ApiError | null = null;
      try {
        await api('/api/x');
      } catch (e) {
        err = e as ApiError;
      }
      expect(err?.status).toBe(500);
      expect(err?.body).toEqual({ message: 'boom' });
      expect(err?.message).toBe('boom');
    });

    it('handles malformed JSON in error response without crashing', async () => {
      mockFetch(
        new Response('{not json', {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        }),
      );
      let err: ApiError | null = null;
      try {
        await api('/api/x');
      } catch (e) {
        err = e as ApiError;
      }
      expect(err?.status).toBe(400);
      expect(err?.body).toBeNull();
      expect(err?.message).toBe('HTTP 400 Bad Request on /api/x');
    });
  });
});

describe('ApiError', () => {
  it('carries status / message / body and is a real Error instance', () => {
    const err = new ApiError(503, 'down', { message: 'down', code: 'unavail' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(503);
    expect(err.message).toBe('down');
    expect(err.body).toEqual({ message: 'down', code: 'unavail' });
  });

  it('defaults body to null', () => {
    const err = new ApiError(500, 'oops');
    expect(err.body).toBeNull();
  });
});
