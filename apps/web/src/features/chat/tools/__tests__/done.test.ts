// done — surfaces a file to the user, scans the preview iframe's console for
// errors, and flips the per-chat `done-gate` on clean runs.
//
// Contract: non-empty `path` required, dispatch `agent-show-file` CustomEvent,
// await AGENT_GET_LOGS, mark gate only when the buffer has no `level==='error'`
// entries.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { doneTool } from '../done';
import { _resetDoneGate, hasDoneFired } from '../../lib/done-gate';
import { asSchema } from './_schema-helpers';

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

interface AgentShowFileDetail {
  filePath: string;
  viewportKey: string;
  target: string;
}

function captureAgentShowFile(): { events: AgentShowFileDetail[]; cleanup: () => void } {
  const events: AgentShowFileDetail[] = [];
  const handler = (e: Event) => {
    const ce = e as CustomEvent<AgentShowFileDetail>;
    events.push(ce.detail);
  };
  window.addEventListener('agent-show-file', handler as EventListener);
  return {
    events,
    cleanup: () => window.removeEventListener('agent-show-file', handler as EventListener),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetDoneGate();
});

afterEach(() => {
  document.body.innerHTML = '';
  _resetDoneGate();
});

describe('done', () => {
  describe('schema', () => {
    it('description mentions surfacing to user + fork_verifier nudge', () => {
      const t = doneTool({ getChatId: () => 'c1' });
      const desc = String(t.description);
      expect(desc).toMatch(/surface|tab bar|user/i);
      expect(desc).toMatch(/fork_verifier/i);
    });

    it('rejects input without a path', () => {
      const t = doneTool({ getChatId: () => 'c1' });
      expect(asSchema(t.inputSchema)?.safeParse({}).success).toBe(false);
    });

    it('rejects input with an empty path string', () => {
      const t = doneTool({ getChatId: () => 'c1' });
      expect(asSchema(t.inputSchema)?.safeParse({ path: '' }).success).toBe(false);
    });

    it('accepts input with a non-empty path string', () => {
      const t = doneTool({ getChatId: () => 'c1' });
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'app.html' }).success).toBe(true);
    });
  });

  describe('happy path (clean console)', () => {
    it('dispatches agent-show-file CustomEvent with filePath / viewportKey=chatId / target=user', async () => {
      setupFakeIframe({
        chatId: 'c1',
        respondWith: () => ({ type: 'AGENT_GET_LOGS_RESULT', ok: true, logs: [] }),
      });
      const capture = captureAgentShowFile();

      const t = doneTool({ getChatId: () => 'c1' });
      await t.execute!({ path: 'app.html' }, ctx);
      capture.cleanup();

      expect(capture.events).toHaveLength(1);
      expect(capture.events[0]).toEqual({
        filePath: 'app.html',
        viewportKey: 'c1',
        target: 'user',
      });
    });

    it('returns "Opened ... for the user. No console errors." with fork_verifier nudge', async () => {
      setupFakeIframe({
        chatId: 'c1',
        respondWith: () => ({ type: 'AGENT_GET_LOGS_RESULT', ok: true, logs: [] }),
      });
      const t = doneTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toContain('Opened app.html for the user.');
      expect(r).toContain('No console errors');
      expect(r).toContain(
        'Next: call fork_verifier_agent (or end your turn if this was a trivial tweak).',
      );
    });

    it('flips the done-gate (hasDoneFired(chatId) === true) after a clean done', async () => {
      setupFakeIframe({
        chatId: 'c1',
        respondWith: () => ({ type: 'AGENT_GET_LOGS_RESULT', ok: true, logs: [] }),
      });
      const t = doneTool({ getChatId: () => 'c1' });
      expect(hasDoneFired('c1')).toBe(false);
      await t.execute!({ path: 'app.html' }, ctx);
      expect(hasDoneFired('c1')).toBe(true);
    });

    it('ignores non-error log levels (log / warn / info / debug do not block the gate)', async () => {
      setupFakeIframe({
        chatId: 'c1',
        respondWith: () => ({
          type: 'AGENT_GET_LOGS_RESULT',
          ok: true,
          logs: [
            { level: 'log', message: 'page rendered', ts: 1000 },
            { level: 'warn', message: 'deprecation foo', ts: 1500 },
            { level: 'info', message: 'mount', ts: 1700 },
          ],
        }),
      });
      const t = doneTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      expect(r).toContain('No console errors');
      expect(hasDoneFired('c1')).toBe(true);
    });
  });

  describe('console errors present', () => {
    it('returns the error count and listed errors with a fix instruction', async () => {
      setupFakeIframe({
        chatId: 'c1',
        respondWith: () => ({
          type: 'AGENT_GET_LOGS_RESULT',
          ok: true,
          logs: [
            { level: 'log', message: 'app start', ts: 1000 },
            { level: 'error', message: 'TypeError: x is not a function', ts: 2000 },
            { level: 'error', message: 'ReferenceError: y is not defined', ts: 2100 },
          ],
        }),
      });
      const t = doneTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      expect(r).toContain('Opened app.html for the user.');
      expect(r).toMatch(/2 console error/);
      expect(r).toContain('TypeError: x is not a function');
      expect(r).toContain('ReferenceError: y is not defined');
      expect(r).toContain('Fix these before calling fork_verifier_agent');
      expect(r).toContain('Call done again when fixed');
    });

    it('does NOT flip the done-gate when console errors are present', async () => {
      setupFakeIframe({
        chatId: 'c1',
        respondWith: () => ({
          type: 'AGENT_GET_LOGS_RESULT',
          ok: true,
          logs: [{ level: 'error', message: 'boom', ts: 2000 }],
        }),
      });
      const t = doneTool({ getChatId: () => 'c1' });
      await t.execute!({ path: 'app.html' }, ctx);
      expect(hasDoneFired('c1')).toBe(false);
    });
  });

  describe('empty / whitespace path', () => {
    it('returns the canonical error string and does not dispatch agent-show-file', async () => {
      const capture = captureAgentShowFile();
      const t = doneTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: '   ' }, ctx)) as string;
      capture.cleanup();
      expect(r).toBe('Error: `done` requires a non-empty file path.');
      expect(capture.events).toHaveLength(0);
      expect(hasDoneFired('c1')).toBe(false);
    });
  });

  describe('iframe unreachable (preview missing)', () => {
    it('returns a clear error string and leaves the gate closed', async () => {
      // No fakeIframe set up — requestFromIframe rejects with iframe-not-found.
      const capture = captureAgentShowFile();
      const t = doneTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      capture.cleanup();
      expect(typeof r).toBe('string');
      expect(r).toMatch(/error/i);
      // The agent-show-file event still fires — that part doesn't need an
      // iframe (it just notifies the host shell). But the console scan is
      // the gate; gate stays closed when we can't verify cleanliness.
      expect(capture.events).toHaveLength(1);
      expect(hasDoneFired('c1')).toBe(false);
    });
  });
});
