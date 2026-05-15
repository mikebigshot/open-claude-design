// screenshot_user_view — main-only sibling of screenshot. Targets the user's
// preview pane.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { screenshotUserViewTool } from '../screenshot-user-view';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface PostedMessage {
  type: string;
  requestId: string;
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

describe('screenshot_user_view', () => {
  it('returns __image_ref envelope on success', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respond: () => ({
        type: 'AGENT_SCREENSHOT_RESULT',
        ok: true,
        dataUrl: 'data:image/png;base64,USERVIEW',
      }),
    });
    const r = (await screenshotUserViewTool({ getChatId: () => 'c1' }).execute!({}, ctx)) as Record<
      string,
      unknown
    >;
    expect(r.__image_ref).toBe(true);
    expect(String(r.path)).toContain('USERVIEW');
  });

  it('input_schema is empty (no required fields)', () => {
    const t = screenshotUserViewTool({ getChatId: () => 'c1' });
    expect(t.inputSchema).toBeTruthy();
  });

  it('description does NOT begin with [verifier-only]', () => {
    const t = screenshotUserViewTool({ getChatId: () => 'c1' });
    expect(String(t.description)).not.toMatch(/verifier-only/i);
    expect(String(t.description)).toMatch(/user/i);
  });

  it('returns Error: ... on failure', async () => {
    setupFakeIframe({
      chatId: 'c1',
      respond: () => ({
        type: 'AGENT_SCREENSHOT_RESULT',
        ok: false,
        error: 'iframe gone',
      }),
    });
    const r = (await screenshotUserViewTool({ getChatId: () => 'c1' }).execute!({}, ctx)) as string;
    expect(r).toMatch(/error/i);
    expect(r).toContain('iframe gone');
  });
});
