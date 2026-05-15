// Tests for iframe-bridge — the postMessage request/response helper used by
// AGENT_* preview tools (screenshot / eval_js / get_webview_logs).
//
// We mock the DOM with a fake iframe that has a contentWindow stub. The bridge
// listens for `message` events on `window` filtered by requestId; on response
// it resolves. We assert the request shape, success path, error path, timeout,
// abort, and that mismatched requestIds are ignored.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestFromIframe } from '../iframe-bridge';

interface PostedMessage {
  type: string;
  requestId: string;
  [k: string]: unknown;
}

function setupIframe(opts: {
  chatId?: string;
  /** Called whenever the bridge posts a message into the iframe. Return a value to auto-respond synchronously, or call respond() manually for async. */
  onPost?: (msg: PostedMessage, respond: (response: Record<string, unknown>) => void) => void;
}) {
  const posted: PostedMessage[] = [];
  const respondFns: Array<(response: Record<string, unknown>) => void> = [];

  const fakeIframe = document.createElement('iframe');
  if (opts.chatId !== undefined) fakeIframe.setAttribute('data-chat-id', opts.chatId);

  // Fake contentWindow.postMessage — sends message, captures it, lets the test
  // arrange the response.
  Object.defineProperty(fakeIframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (msg: unknown, _origin: string) => {
        const m = msg as PostedMessage;
        posted.push(m);
        const respond = (response: Record<string, unknown>) => {
          // Dispatch a real `message` event on window so the bridge picks it up.
          const ev = new MessageEvent('message', {
            data: { ...response, requestId: m.requestId },
            source: fakeIframe.contentWindow as never,
          });
          window.dispatchEvent(ev);
        };
        respondFns.push(respond);
        if (opts.onPost) opts.onPost(m, respond);
      },
    },
  });

  document.body.appendChild(fakeIframe);
  return { fakeIframe, posted, respondFns };
}

describe('requestFromIframe', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('posts the right shape (type, requestId, payload) into the matching iframe', async () => {
    const { posted } = setupIframe({
      chatId: 'c1',
      onPost: (msg, respond) => {
        respond({ type: 'AGENT_EVAL_JS_RESULT', ok: true, value: '"hi"' });
      },
    });
    const result = await requestFromIframe<{ ok: true; value: string }>({
      chatId: 'c1',
      type: 'AGENT_EVAL_JS',
      payload: { code: 'document.title' },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('AGENT_EVAL_JS');
    expect(typeof posted[0]?.requestId).toBe('string');
    expect(posted[0]?.code).toBe('document.title');
    expect(result).toEqual({
      type: 'AGENT_EVAL_JS_RESULT',
      ok: true,
      value: '"hi"',
      requestId: posted[0]?.requestId,
    });
  });

  it('ignores responses with a non-matching requestId', async () => {
    const { posted } = setupIframe({
      chatId: 'c1',
      onPost: (_msg, _respond) => {
        // Send a stray message with a different requestId.
        const stray = new MessageEvent('message', {
          data: { type: 'AGENT_EVAL_JS_RESULT', requestId: 'not-mine', ok: true, value: '0' },
        });
        window.dispatchEvent(stray);
        // Then the real one.
        setTimeout(
          () => _respond({ type: 'AGENT_EVAL_JS_RESULT', ok: true, value: '"correct"' }),
          0,
        );
      },
    });
    const result = await requestFromIframe<{ value: string }>({
      chatId: 'c1',
      type: 'AGENT_EVAL_JS',
      payload: { code: 'x' },
    });
    expect(result.value).toBe('"correct"');
    expect(posted).toHaveLength(1);
  });

  it('rejects on timeout', async () => {
    setupIframe({ chatId: 'c1' /* no auto-respond */ });
    await expect(
      requestFromIframe({
        chatId: 'c1',
        type: 'AGENT_EVAL_JS',
        payload: { code: 'x' },
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/timeout/i);
  });

  it('rejects when the abort signal fires', async () => {
    setupIframe({ chatId: 'c1' });
    const controller = new AbortController();
    const promise = requestFromIframe({
      chatId: 'c1',
      type: 'AGENT_EVAL_JS',
      payload: { code: 'x' },
      signal: controller.signal,
      timeoutMs: 1000,
    });
    setTimeout(() => controller.abort(), 5);
    await expect(promise).rejects.toThrow(/abort/i);
  });

  it('rejects with iframe-not-found when no iframe matches the chatId', async () => {
    // No iframe set up.
    await expect(
      requestFromIframe({
        chatId: 'missing',
        type: 'AGENT_EVAL_JS',
        payload: { code: 'x' },
      }),
    ).rejects.toThrow(/iframe/i);
  });

  it('falls back to any iframe when chatId-specific not found, picking the first', async () => {
    // Set up an iframe with no matching data-chat-id.
    const { posted } = setupIframe({
      chatId: undefined,
      onPost: (_msg, respond) => {
        respond({ type: 'AGENT_GET_LOGS_RESULT', ok: true, logs: [] });
      },
    });
    const result = await requestFromIframe<{ logs: unknown[] }>({
      chatId: 'whatever',
      type: 'AGENT_GET_LOGS',
    });
    expect(posted).toHaveLength(1);
    expect(result.logs).toEqual([]);
  });

  it('removes its window message listener after resolving (no leak across calls)', async () => {
    const { fakeIframe } = setupIframe({
      chatId: 'c1',
      onPost: (_msg, respond) => {
        respond({ type: 'AGENT_EVAL_JS_RESULT', ok: true, value: '1' });
      },
    });
    await requestFromIframe({ chatId: 'c1', type: 'AGENT_EVAL_JS', payload: { code: 'x' } });
    // After settle, dispatch a stray message and ensure no errors / no resolution attempts surface.
    // We don't have a direct counter, so spy on addEventListener to confirm a paired removeEventListener.
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    await requestFromIframe({
      chatId: 'c1',
      type: 'AGENT_EVAL_JS',
      payload: { code: 'y' },
    });
    expect(addSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    addSpy.mockRestore();
    removeSpy.mockRestore();
    // Sanity: iframe still in DOM.
    expect(fakeIframe.parentElement).toBe(document.body);
  });

  it('does not log unhandled-rejection on timeout', async () => {
    setupIframe({ chatId: 'c1' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await requestFromIframe({
        chatId: 'c1',
        type: 'AGENT_GET_LOGS',
        timeoutMs: 10,
      });
    } catch {
      /* expected */
    }
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
