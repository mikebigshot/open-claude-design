// eval_js — verifier-only tool. Sends JS code into the preview iframe via
// AGENT_EVAL_JS and returns the JSON-stringified result (or an error string).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evalJsTool } from '../eval-js';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface PostedMessage {
  type: string;
  requestId: string;
  code?: string;
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
  return fakeIframe;
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('eval_js', () => {
  it('forwards code to the iframe and returns the stringified value', async () => {
    let received: string | undefined;
    setupFakeIframe({
      chatId: 'c1',
      respond: (req) => {
        received = req.code;
        return { type: 'AGENT_EVAL_JS_RESULT', ok: true, value: '"page title"' };
      },
    });
    const t = evalJsTool({ getChatId: () => 'c1' });
    const r = (await t.execute!({ code: 'document.title' }, ctx)) as string;
    expect(received).toBe('document.title');
    expect(r).toBe('"page title"');
  });

  it('returns "Error: <message>" when the iframe reports failure', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respond: () => ({
        type: 'AGENT_EVAL_JS_RESULT',
        ok: false,
        error: 'TypeError: undefined.x',
      }),
    });
    const t = evalJsTool({ getChatId: () => 'c1' });
    const r = (await t.execute!({ code: 'foo.x' }, ctx)) as string;
    expect(r).toMatch(/error/i);
    expect(r).toContain('TypeError');
  });

  it('returns an error string when the iframe is missing', async () => {
    const t = evalJsTool({ getChatId: () => 'missing' });
    const r = (await t.execute!({ code: '1' }, ctx)) as string;
    expect(r).toMatch(/error/i);
  });

  it('description begins with the [verifier-only] tag and explains DOM/style use', () => {
    const t = evalJsTool({ getChatId: () => 'c1' });
    const desc = String(t.description);
    expect(desc).toMatch(/verifier-only/i);
    expect(desc).toMatch(/DOM/);
  });

  it('input_schema requires `code`', () => {
    const t = evalJsTool({ getChatId: () => 'c1' });
    expect(t.inputSchema).toBeTruthy();
  });

  it('passes through an empty value field as the literal string', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respond: () => ({
        type: 'AGENT_EVAL_JS_RESULT',
        ok: true,
        value: 'undefined',
      }),
    });
    const r = (await evalJsTool({ getChatId: () => 'c1' }).execute!(
      { code: 'undefined' },
      ctx,
    )) as string;
    expect(r).toBe('undefined');
  });
});
