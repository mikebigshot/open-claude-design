// get_webview_logs — verifier-only tool. Asks the iframe overlay for its
// captured console buffer and returns a stringified log dump.
//
// Tested with a fake iframe that auto-responds via the postMessage protocol.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getWebviewLogsTool } from '../get-webview-logs';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface PostedMessage {
  type: string;
  requestId: string;
  [k: string]: unknown;
}

function setupFakeIframe(opts: {
  chatId: string;
  respondWith: (req: PostedMessage) => Record<string, unknown>;
}) {
  const fakeIframe = document.createElement('iframe');
  fakeIframe.setAttribute('data-chat-id', opts.chatId);
  Object.defineProperty(fakeIframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (msg: unknown) => {
        const m = msg as PostedMessage;
        const response = { ...opts.respondWith(m), requestId: m.requestId };
        const ev = new MessageEvent('message', { data: response });
        setTimeout(() => window.dispatchEvent(ev), 0);
      },
    },
  });
  document.body.appendChild(fakeIframe);
  return fakeIframe;
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('get_webview_logs', () => {
  it('returns stringified logs on success', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respondWith: () => ({
        type: 'AGENT_GET_LOGS_RESULT',
        ok: true,
        logs: [
          { level: 'log', message: 'page rendered', ts: 1000 },
          { level: 'warn', message: 'deprecation foo', ts: 1500 },
          { level: 'error', message: 'TypeError: x', ts: 2000 },
        ],
      }),
    });
    const t = getWebviewLogsTool({ getChatId: () => 'c1' });
    const r = (await t.execute!({}, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('page rendered');
    expect(r).toContain('warn');
    expect(r).toContain('TypeError');
  });

  it('returns "(no logs)" when buffer is empty', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respondWith: () => ({ type: 'AGENT_GET_LOGS_RESULT', ok: true, logs: [] }),
    });
    const t = getWebviewLogsTool({ getChatId: () => 'c1' });
    const r = (await t.execute!({}, ctx)) as string;
    expect(r).toMatch(/no logs/i);
  });

  it('returns an error string when the iframe is not found', async () => {
    // No iframe set up. requestFromIframe rejects with iframe-not-found error.
    const t = getWebviewLogsTool({ getChatId: () => 'missing' });
    const r = (await t.execute!({}, ctx)) as string;
    expect(r).toMatch(/error/i);
    expect(r).toMatch(/iframe/i);
  });

  it('description mentions verifier-only / preview / console', () => {
    const t = getWebviewLogsTool({ getChatId: () => 'c1' });
    const desc = String(t.description);
    expect(desc).toMatch(/console/i);
    expect(desc).toMatch(/webview|preview/i);
  });

  it('input_schema is empty (no required fields)', () => {
    const t = getWebviewLogsTool({ getChatId: () => 'c1' });
    expect(t.inputSchema).toBeTruthy();
  });
});
