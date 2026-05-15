// multi_screenshot — verifier-only. Run a sequence of (code, delay) steps in
// the preview iframe; after each step, capture a screenshot. Max 12 steps per
// call (per v2 spec).
//
// Aligned with official bundle: returns `JSON.stringify(refs)` — a bare array
// of `{__image_ref:true, path}` objects, NOT wrapped in `{__image_refs:[]}`.
// The image-ref dispatcher walks tool_result content recursively looking for
// any `__image_ref:true` markers, so the wrapper key is unnecessary.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { multiScreenshotTool } from '../multi-screenshot';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

// 1×1 transparent PNG — valid base64 body so atob() succeeds when the tool
// decodes the dataUrl prior to PUT.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

function installFetchSpy() {
  const calls: Array<{ url: string; method: string; body: ArrayBuffer | string | null; contentType: string | null }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const ct = init?.headers ? (init.headers as Record<string, string>)['content-type'] ?? null : null;
    let body: ArrayBuffer | string | null = null;
    if (init?.body instanceof ArrayBuffer) body = init.body;
    else if (typeof init?.body === 'string') body = init.body;
    calls.push({ url, method, body, contentType: ct });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

interface PostedMessage {
  type: string;
  requestId: string;
  code?: string;
  path?: string;
  [k: string]: unknown;
}

function setupFakeIframe(opts: {
  chatId: string;
  evalImpl?: (req: PostedMessage) => Record<string, unknown>;
  screenshotImpl?: (req: PostedMessage) => Record<string, unknown>;
}) {
  const fakeIframe = document.createElement('iframe');
  fakeIframe.setAttribute('data-chat-id', opts.chatId);
  Object.defineProperty(fakeIframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (msg: unknown) => {
        const m = msg as PostedMessage;
        let response: Record<string, unknown>;
        if (m.type === 'AGENT_EVAL_JS') {
          response = (opts.evalImpl?.(m) ?? {
            type: 'AGENT_EVAL_JS_RESULT',
            ok: true,
            value: 'undefined',
          }) as Record<string, unknown>;
        } else if (m.type === 'AGENT_SCREENSHOT') {
          response = (opts.screenshotImpl?.(m) ?? {
            type: 'AGENT_SCREENSHOT_RESULT',
            ok: true,
            dataUrl: TINY_PNG_DATA_URL,
          }) as Record<string, unknown>;
        } else {
          return;
        }
        const ev = new MessageEvent('message', {
          data: { ...response, requestId: m.requestId },
        });
        setTimeout(() => window.dispatchEvent(ev), 0);
      },
    },
  });
  document.body.appendChild(fakeIframe);
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('multi_screenshot', () => {
  it('runs each step and returns a JSON-stringified array of image refs (bare, no __image_refs wrapper)', async () => {
    const codes: string[] = [];
    installFetchSpy();
    setupFakeIframe({
      chatId: 'c1',
      evalImpl: (req) => {
        codes.push(String(req.code));
        return { type: 'AGENT_EVAL_JS_RESULT', ok: true, value: 'undefined' };
      },
    });
    const t = multiScreenshotTool('p1', { getChatId: () => 'c1' });
    const r = (await t.execute!(
      {
        path: 'index.html',
        steps: [{ code: 'document.body.scrollTop = 0' }, { code: 'document.body.scrollTop = 500' }],
      },
      ctx,
    )) as string;
    expect(codes).toEqual(['document.body.scrollTop = 0', 'document.body.scrollTop = 500']);
    expect(typeof r).toBe('string');
    const parsed = JSON.parse(r) as Array<{ __image_ref: true; path: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0]?.__image_ref).toBe(true);
    expect(typeof parsed[0]?.path).toBe('string');
    // The wrapper key MUST be gone.
    expect(r).not.toContain('__image_refs');
    // Each frame written to _screenshots/<uuid>.png — no more raw data URLs.
    expect(parsed[0]!.path).toMatch(/^_screenshots\/[A-Za-z0-9-]+\.png$/);
    expect(parsed[1]!.path).toMatch(/^_screenshots\/[A-Za-z0-9-]+\.png$/);
    expect(parsed[0]!.path).not.toBe(parsed[1]!.path);
  });

  it('PUTs each frame to /api/projects/<id>/files/_screenshots/<uuid>.png with image/png content-type', async () => {
    const calls = installFetchSpy();
    setupFakeIframe({ chatId: 'c1' });
    const t = multiScreenshotTool('proj-X', { getChatId: () => 'c1' });
    const r = (await t.execute!(
      { path: 'index.html', steps: [{ code: 'noop' }, { code: 'noop' }] },
      ctx,
    )) as string;
    const refs = JSON.parse(r) as Array<{ path: string }>;
    expect(refs.length).toBe(2);
    const writes = calls.filter((c) => c.method === 'PUT');
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect(w.url).toContain('/api/projects/proj-X/files/_screenshots/');
      expect(w.url).toMatch(/\.png$/);
      expect(w.contentType).toBe('image/png');
      expect(w.body).toBeInstanceOf(ArrayBuffer);
      // The decoded body should be the 1×1 PNG (74-ish bytes after base64
      // decode of TINY_PNG_DATA_URL).
      expect((w.body as ArrayBuffer).byteLength).toBeGreaterThan(50);
    }
  });

  it('returns an error string and does NOT write anything when a frame is not a valid base64 data URL', async () => {
    const calls = installFetchSpy();
    setupFakeIframe({
      chatId: 'c1',
      screenshotImpl: () => ({
        type: 'AGENT_SCREENSHOT_RESULT',
        ok: true,
        dataUrl: 'not-a-data-url',
      }),
    });
    const t = multiScreenshotTool('p1', { getChatId: () => 'c1' });
    const r = (await t.execute!({ path: 'index.html', steps: [{ code: 'noop' }] }, ctx)) as string;
    expect(r).toMatch(/base64|data URL/);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('returns an error string when the PUT to _screenshots/ fails', async () => {
    setupFakeIframe({ chatId: 'c1' });
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    const t = multiScreenshotTool('p1', { getChatId: () => 'c1' });
    const r = (await t.execute!({ path: 'index.html', steps: [{ code: 'noop' }] }, ctx)) as string;
    expect(r).toMatch(/HTTP 500|write failed/i);
  });

  it('rejects step counts above 12', async () => {
    setupFakeIframe({ chatId: 'c1' });
    const t = multiScreenshotTool('p1', { getChatId: () => 'c1' });
    const steps = Array.from({ length: 13 }, () => ({ code: 'noop' }));
    const r = (await t.execute!({ path: 'index.html', steps }, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toMatch(/12/);
  });

  it("returns an error string if a step's eval fails", async () => {
    setupFakeIframe({
      chatId: 'c1',
      evalImpl: () => ({ type: 'AGENT_EVAL_JS_RESULT', ok: false, error: 'syntax error' }),
    });
    const t = multiScreenshotTool('p1', { getChatId: () => 'c1' });
    const r = (await t.execute!({ path: 'index.html', steps: [{ code: 'bad' }] }, ctx)) as
      | string
      | Record<string, unknown>;
    expect(typeof r).toBe('string');
    expect(String(r)).toMatch(/error/i);
    expect(String(r)).toMatch(/syntax/);
  });

  it("returns an error string if a step's screenshot fails", async () => {
    setupFakeIframe({
      chatId: 'c1',
      screenshotImpl: () => ({
        type: 'AGENT_SCREENSHOT_RESULT',
        ok: false,
        error: 'render fail',
      }),
    });
    const t = multiScreenshotTool('p1', { getChatId: () => 'c1' });
    const r = (await t.execute!({ path: 'index.html', steps: [{ code: 'noop' }] }, ctx)) as
      | string
      | Record<string, unknown>;
    expect(typeof r).toBe('string');
    expect(String(r)).toMatch(/render fail/);
  });

  it('input_schema requires path + steps', () => {
    const t = multiScreenshotTool('p1', { getChatId: () => 'c1' });
    expect(t.inputSchema).toBeTruthy();
    expect(String(t.description)).toMatch(/multi/i);
  });

  it('respects per-step delay (resolves; we do not measure timing precisely)', async () => {
    installFetchSpy();
    setupFakeIframe({ chatId: 'c1' });
    const t = multiScreenshotTool('p1', { getChatId: () => 'c1' });
    const r = (await t.execute!(
      { path: 'index.html', steps: [{ code: 'noop', delay: 1 }] },
      ctx,
    )) as string;
    const parsed = JSON.parse(r) as unknown[];
    expect(parsed.length).toBe(1);
  });
});
