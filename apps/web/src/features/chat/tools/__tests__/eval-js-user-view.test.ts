// eval_js_user_view — main-agent equivalent of eval_js. Targets the user's
// preview iframe (not the verifier's own). Both ride the same
// iframe; the distinction lives in description + name.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evalJsUserViewTool } from '../eval-js-user-view';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface PostedMessage {
  type: string;
  requestId: string;
  code?: string;
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

describe('eval_js_user_view', () => {
  it('runs JS in the user view and returns the value', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respond: () => ({ type: 'AGENT_EVAL_JS_RESULT', ok: true, value: '42' }),
    });
    const r = (await evalJsUserViewTool({ getChatId: () => 'c1' }).execute!(
      { code: '6 * 7' },
      ctx,
    )) as string;
    expect(r).toBe('42');
  });

  it('description does NOT begin with [verifier-only] (this is main-only)', () => {
    const t = evalJsUserViewTool({ getChatId: () => 'c1' });
    const desc = String(t.description);
    expect(desc).not.toMatch(/verifier-only/i);
    // Should mention USER's preview pane.
    expect(desc).toMatch(/user/i);
  });

  it('returns Error: ... on failure', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respond: () => ({ type: 'AGENT_EVAL_JS_RESULT', ok: false, error: 'permission denied' }),
    });
    const r = (await evalJsUserViewTool({ getChatId: () => 'c1' }).execute!(
      { code: 'navigator.bluetooth' },
      ctx,
    )) as string;
    expect(r).toMatch(/error/i);
    expect(r).toContain('permission');
  });
});
