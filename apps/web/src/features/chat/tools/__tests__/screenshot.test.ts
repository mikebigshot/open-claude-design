// screenshot — verifier-only tool. Asks the iframe overlay to render its DOM
// to a dataURL via html-to-image (or our minimal substitute). Returns an
// `__image_ref` envelope so W1's image-ref dispatcher can lift it into a
// proper image content block on the next LLM turn.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { screenshotTool } from '../screenshot';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface PostedMessage {
  type: string;
  requestId: string;
  path?: string;
  [k: string]: unknown;
}

function setupFakeIframe(opts: {
  chatId: string;
  respond: (req: PostedMessage) => Record<string, unknown>;
}) {
  const fakeIframe = document.createElement('iframe');
  fakeIframe.setAttribute('data-chat-id', opts.chatId);
  Object.defineProperty(fakeIframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (msg: unknown) => {
        const m = msg as PostedMessage;
        const response = { ...opts.respond(m), requestId: m.requestId };
        const ev = new MessageEvent('message', { data: response });
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

describe('screenshot', () => {
  it('returns __image_ref envelope on success', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respond: () => ({
        type: 'AGENT_SCREENSHOT_RESULT',
        ok: true,
        dataUrl: 'data:image/png;base64,XYZ',
      }),
    });
    const t = screenshotTool({ getChatId: () => 'c1' });
    const r = (await t.execute!({ path: 'index.html' }, ctx)) as Record<string, unknown>;
    expect(r.__image_ref).toBe(true);
    expect(typeof r.path).toBe('string');
    expect(String(r.path)).toMatch(/^data:image/);
  });

  it('forwards the path argument to the iframe', async () => {
    let receivedPath: string | undefined;
    setupFakeIframe({
      chatId: 'c1',
      respond: (req) => {
        receivedPath = req.path;
        return { type: 'AGENT_SCREENSHOT_RESULT', ok: true, dataUrl: 'data:,x' };
      },
    });
    await screenshotTool({ getChatId: () => 'c1' }).execute!({ path: 'pages/hero.html' }, ctx);
    expect(receivedPath).toBe('pages/hero.html');
  });

  it('returns an error string when the iframe responds ok=false', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respond: () => ({
        type: 'AGENT_SCREENSHOT_RESULT',
        ok: false,
        error: 'foreignObject conversion failed',
      }),
    });
    const r = (await screenshotTool({ getChatId: () => 'c1' }).execute!(
      { path: 'index.html' },
      ctx,
    )) as string | Record<string, unknown>;
    expect(typeof r).toBe('string');
    expect(String(r)).toMatch(/error/i);
    expect(String(r)).toContain('foreignObject');
  });

  it('returns an error string when no iframe exists', async () => {
    const r = (await screenshotTool({ getChatId: () => 'c1' }).execute!(
      { path: 'index.html' },
      ctx,
    )) as string;
    expect(typeof r).toBe('string');
    expect(r).toMatch(/error/i);
  });

  it('description begins with [verifier-only]', () => {
    const t = screenshotTool({ getChatId: () => 'c1' });
    expect(String(t.description)).toMatch(/verifier-only/i);
  });

  it('input_schema requires `path`', () => {
    const t = screenshotTool({ getChatId: () => 'c1' });
    expect(t.inputSchema).toBeTruthy();
  });
});
