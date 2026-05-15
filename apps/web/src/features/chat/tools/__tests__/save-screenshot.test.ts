// save_screenshot — two-mode capture: disk (save_path) or in-memory
// (in_memory_png_key). Tests use a fake iframe to drive AGENT_EVAL_JS /
// AGENT_SCREENSHOT RPC and assert disk PUTs + window.__captures pool.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveScreenshotTool } from '../save-screenshot';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface PostedMessage {
  type: string;
  requestId: string;
  code?: string;
  [k: string]: unknown;
}

function setupFakeIframe(opts: {
  chatId: string;
  evalImpl?: (req: PostedMessage) => Record<string, unknown>;
  screenshotImpl?: (req: PostedMessage) => Record<string, unknown>;
}) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-chat-id', opts.chatId);
  iframe.setAttribute('data-viewport', 'user');
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (msg: unknown) => {
        const m = msg as PostedMessage;
        let response: Record<string, unknown>;
        if (m.type === 'AGENT_EVAL_JS') {
          response = opts.evalImpl
            ? opts.evalImpl(m)
            : { type: 'AGENT_EVAL_JS_RESULT', ok: true, value: 'undefined' };
        } else if (m.type === 'AGENT_SCREENSHOT') {
          response = opts.screenshotImpl
            ? opts.screenshotImpl(m)
            : {
                type: 'AGENT_SCREENSHOT_RESULT',
                ok: true,
                // Tiny valid base64-encoded PNG-ish payload (just 1 byte of
                // 0xFF — atob-decodable, body bytes don't matter for tests).
                dataUrl: 'data:image/png;base64,/w==',
              };
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
  document.body.appendChild(iframe);
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__captures;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__captures;
});

describe('save_screenshot', () => {
  describe('schema', () => {
    it('requires save_path XOR in_memory_png_key', () => {
      const t = saveScreenshotTool('p', { getChatId: () => 'c1' });
      expect(
        asSchema(t.inputSchema)?.safeParse({ steps: [{}], save_path: 'a.png' }).success,
      ).toBe(true);
      expect(
        asSchema(t.inputSchema)?.safeParse({ steps: [{}], in_memory_png_key: 'k' }).success,
      ).toBe(true);
      // both → invalid
      expect(
        asSchema(t.inputSchema)?.safeParse({
          steps: [{}],
          save_path: 'a.png',
          in_memory_png_key: 'k',
        }).success,
      ).toBe(false);
      // neither → invalid
      expect(asSchema(t.inputSchema)?.safeParse({ steps: [{}] }).success).toBe(false);
    });

    it('caps steps at 100', () => {
      const t = saveScreenshotTool('p', { getChatId: () => 'c1' });
      const steps = Array.from({ length: 101 }, () => ({}));
      expect(
        asSchema(t.inputSchema)?.safeParse({ steps, save_path: 'a.png' }).success,
      ).toBe(false);
    });
  });

  describe('in-memory mode', () => {
    it('stashes Blob[] under window.__captures[key] (run_script back-compat alias)', async () => {
      setupFakeIframe({ chatId: 'c1' });
      // Stub fetch (shouldn't be called in this branch but be defensive).
      globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;

      const t = saveScreenshotTool('p', { getChatId: () => 'c1' });
      const r = (await t.execute!(
        { steps: [{}, {}], in_memory_png_key: 'thumbs' },
        ctx,
      )) as string;
      expect(r).toMatch(/in-memory pool/);
      expect(r).toMatch(/__pool:thumbs/);
      const pool = (window as unknown as { __captures?: Record<string, Blob[]> }).__captures!;
      const thumbs = pool.thumbs!;
      expect(thumbs).toHaveLength(2);
      expect(thumbs[0]?.type).toBe('image/png');
    });

    it('also writes to the canonical screenshot-pool so view_image can resolve __pool:<key>:<idx>', async () => {
      setupFakeIframe({ chatId: 'c1' });
      globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
      // Import lazily so the canonical pool module is loaded only when the
      // test asserts on it — keeps the rest of the suite hermetic.
      const { getScreenshotCaptureCount, getScreenshotCapture, _resetScreenshotPool } =
        await import('../../lib/screenshot-pool');
      _resetScreenshotPool();

      const t = saveScreenshotTool('p', { getChatId: () => 'c1' });
      await t.execute!({ steps: [{}, {}, {}], in_memory_png_key: 'frames' }, ctx);
      expect(getScreenshotCaptureCount('frames')).toBe(3);
      expect(getScreenshotCapture('frames', 0)?.type).toBe('image/png');
      expect(getScreenshotCapture('frames', 2)?.type).toBe('image/png');
    });
  });

  describe('disk mode', () => {
    it('PUTs each capture with a 2-digit prefix when multi-step', async () => {
      setupFakeIframe({ chatId: 'c1' });
      const puts: { url: string; bodyType?: string }[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        puts.push({
          url: String(input),
          bodyType:
            init?.body instanceof Uint8Array ? 'Uint8Array' : typeof init?.body,
        });
        return new Response('', { status: 200 });
      }) as typeof fetch;

      const t = saveScreenshotTool('p1', { getChatId: () => 'c1' });
      const r = (await t.execute!(
        { steps: [{}, {}, {}], save_path: 'shots/hero.png' },
        ctx,
      )) as string;
      expect(puts.map((p) => p.url)).toEqual([
        '/api/projects/p1/files/shots/01-hero.png',
        '/api/projects/p1/files/shots/02-hero.png',
        '/api/projects/p1/files/shots/03-hero.png',
      ]);
      expect(puts[0]?.bodyType).toBe('Uint8Array');
      expect(r).toMatch(/Saved 3 screenshots to/);
    });

    it('single-step disk save uses save_path verbatim (no prefix)', async () => {
      setupFakeIframe({ chatId: 'c1' });
      let calledUrl = '';
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calledUrl = String(input);
        return new Response('', { status: 200 });
      }) as typeof fetch;
      const t = saveScreenshotTool('p1', { getChatId: () => 'c1' });
      await t.execute!({ steps: [{}], save_path: 'one.png' }, ctx);
      expect(calledUrl).toBe('/api/projects/p1/files/one.png');
    });

    it('surfaces PUT failure with the failing step + path', async () => {
      setupFakeIframe({ chatId: 'c1' });
      globalThis.fetch = (async () =>
        new Response('', { status: 500 })) as typeof fetch;
      const t = saveScreenshotTool('p1', { getChatId: () => 'c1' });
      const r = (await t.execute!(
        { steps: [{}], save_path: 'a.png' },
        ctx,
      )) as string;
      expect(r).toMatch(/Error/);
      expect(r).toMatch(/step 1 save to "a\.png" failed/);
    });
  });

  describe('per-step error paths', () => {
    it('surfaces eval failure with the step number', async () => {
      setupFakeIframe({
        chatId: 'c1',
        evalImpl: () => ({
          type: 'AGENT_EVAL_JS_RESULT',
          ok: false,
          error: 'syntax error',
        }),
      });
      const t = saveScreenshotTool('p1', { getChatId: () => 'c1' });
      const r = (await t.execute!(
        { steps: [{ code: 'bad' }], save_path: 'a.png' },
        ctx,
      )) as string;
      expect(r).toMatch(/step 1 eval failed/);
      expect(r).toMatch(/syntax error/);
    });

    it('surfaces screenshot failure with the step number', async () => {
      setupFakeIframe({
        chatId: 'c1',
        screenshotImpl: () => ({
          type: 'AGENT_SCREENSHOT_RESULT',
          ok: false,
          error: 'render crash',
        }),
      });
      const t = saveScreenshotTool('p1', { getChatId: () => 'c1' });
      const r = (await t.execute!(
        { steps: [{}], save_path: 'a.png' },
        ctx,
      )) as string;
      expect(r).toMatch(/step 1 screenshot failed/);
      expect(r).toMatch(/render crash/);
    });
  });
});
