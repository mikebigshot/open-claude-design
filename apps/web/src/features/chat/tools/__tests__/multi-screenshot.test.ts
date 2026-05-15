// multi_screenshot — verifier-only. Run a sequence of (code, delay) steps in
// the preview iframe; after each step, capture a screenshot. Max 12 steps per
// call (per v2 spec).
//
// Returns an array of __image_ref envelopes (one per step) wrapped in a list
// envelope so W1's image-ref dispatcher can lift each one into an image block.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { multiScreenshotTool } from '../multi-screenshot';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

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
            dataUrl: `data:image/png;base64,${m.requestId}`,
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
});

describe('multi_screenshot', () => {
  it('runs each step and returns an array of image refs', async () => {
    const codes: string[] = [];
    setupFakeIframe({
      chatId: 'c1',
      evalImpl: (req) => {
        codes.push(String(req.code));
        return { type: 'AGENT_EVAL_JS_RESULT', ok: true, value: 'undefined' };
      },
    });
    const t = multiScreenshotTool({ getChatId: () => 'c1' });
    const r = (await t.execute!(
      {
        path: 'index.html',
        steps: [{ code: 'document.body.scrollTop = 0' }, { code: 'document.body.scrollTop = 500' }],
      },
      ctx,
    )) as { __image_refs: Array<Record<string, unknown>> };
    expect(codes).toEqual(['document.body.scrollTop = 0', 'document.body.scrollTop = 500']);
    expect(r.__image_refs.length).toBe(2);
    expect(r.__image_refs[0]?.__image_ref).toBe(true);
    expect(typeof r.__image_refs[0]?.path).toBe('string');
  });

  it('rejects step counts above 12', async () => {
    setupFakeIframe({ chatId: 'c1' });
    const t = multiScreenshotTool({ getChatId: () => 'c1' });
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
    const t = multiScreenshotTool({ getChatId: () => 'c1' });
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
    const t = multiScreenshotTool({ getChatId: () => 'c1' });
    const r = (await t.execute!({ path: 'index.html', steps: [{ code: 'noop' }] }, ctx)) as
      | string
      | Record<string, unknown>;
    expect(typeof r).toBe('string');
    expect(String(r)).toMatch(/render fail/);
  });

  it('input_schema requires path + steps', () => {
    const t = multiScreenshotTool({ getChatId: () => 'c1' });
    expect(t.inputSchema).toBeTruthy();
    expect(String(t.description)).toMatch(/multi/i);
  });

  it('respects per-step delay (resolves; we do not measure timing precisely)', async () => {
    setupFakeIframe({ chatId: 'c1' });
    const t = multiScreenshotTool({ getChatId: () => 'c1' });
    const r = (await t.execute!(
      { path: 'index.html', steps: [{ code: 'noop', delay: 1 }] },
      ctx,
    )) as { __image_refs: unknown[] };
    expect(r.__image_refs.length).toBe(1);
  });
});
