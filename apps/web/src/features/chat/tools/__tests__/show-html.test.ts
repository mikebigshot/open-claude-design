// show_html — load an HTML file into the agent's preview iframe.
//
// Aligned to claude.ai/design bundle Bu8zJzmd: dispatches `agent-show-file`
// with `{filePath, viewportKey}` (no `target` field — routing is via
// viewportKey suffix `::verifier`, not target). For main-agent chats (chatId
// does NOT contain `::`) the tool first nudges the agent to call `done` then
// `fork_verifier_agent`; the nudge fires once per chat (the same gate used
// by `fork_verifier_agent` is set so the next show_html call proceeds
// normally even without `done`).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDoneGate, markDone } from '../../lib/done-gate';
import { showHtmlTool } from '../show-html';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface ShowDetail {
  filePath: string;
  viewportKey: string;
}

function capture(name: string): { events: ShowDetail[]; cleanup: () => void } {
  const events: ShowDetail[] = [];
  const handler = (e: Event) =>
    events.push((e as CustomEvent<ShowDetail>).detail);
  window.addEventListener(name, handler as EventListener);
  return {
    events,
    cleanup: () => window.removeEventListener(name, handler as EventListener),
  };
}

describe('show_html', () => {
  beforeEach(() => _resetDoneGate());
  afterEach(() => _resetDoneGate());

  describe('schema', () => {
    it('description mentions YOUR preview iframe (not the user pane)', () => {
      const t = showHtmlTool({ getChatId: () => 'c1' });
      const desc = String(t.description);
      expect(desc).toMatch(/your preview iframe/i);
      expect(desc.toLowerCase()).not.toContain('agent-private');
      expect(desc).toMatch(/get_webview_logs/);
      expect(desc).toMatch(/show_to_user/);
    });

    it('requires non-empty path', () => {
      const t = showHtmlTool({ getChatId: () => 'c1' });
      expect(asSchema(t.inputSchema)?.safeParse({ path: '' }).success).toBe(false);
      expect(asSchema(t.inputSchema)?.safeParse({}).success).toBe(false);
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'app.html' }).success).toBe(true);
    });
  });

  describe('verifier sub-agent path (chatId contains "::")', () => {
    it('dispatches agent-show-file with viewportKey only — no target field', async () => {
      const cap = capture('agent-show-file');
      const t = showHtmlTool({ getChatId: () => 'c1::verifier' });
      await t.execute!({ path: 'app.html' }, ctx);
      cap.cleanup();
      expect(cap.events).toEqual([
        { filePath: 'app.html', viewportKey: 'c1::verifier' },
      ]);
    });

    it('returns a confirmation string referencing get_webview_logs', async () => {
      const t = showHtmlTool({ getChatId: () => 'c1::verifier' });
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/Opened app\.html/);
      expect(r).toMatch(/your iframe/i);
      expect(r).toMatch(/get_webview_logs/);
    });
  });

  describe('main-agent path (chatId does NOT contain "::")', () => {
    it('first call returns the advisory nudge instead of dispatching', async () => {
      const cap = capture('agent-show-file');
      const t = showHtmlTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      cap.cleanup();
      expect(cap.events).toHaveLength(0);
      expect(r).toMatch(/Before self-inspecting/);
      expect(r).toMatch(/calling `?done`? first/);
      expect(r).toMatch(/fork_verifier_agent/);
    });

    it('second call after the nudge proceeds (gate set on first call)', async () => {
      const t = showHtmlTool({ getChatId: () => 'c1' });
      // First call sets the gate + returns nudge.
      await t.execute!({ path: 'app.html' }, ctx);
      // Second call now proceeds because the gate is set.
      const cap = capture('agent-show-file');
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      cap.cleanup();
      expect(cap.events).toEqual([{ filePath: 'app.html', viewportKey: 'c1' }]);
      expect(r).toMatch(/Opened app\.html/);
      expect(r).toMatch(/get_webview_logs/);
    });

    it('if `done` has already fired for this chat, proceeds without nudge', async () => {
      markDone('c1');
      const cap = capture('agent-show-file');
      const t = showHtmlTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      cap.cleanup();
      expect(cap.events).toEqual([{ filePath: 'app.html', viewportKey: 'c1' }]);
      expect(r).not.toMatch(/Before self-inspecting/);
      expect(r).toMatch(/Opened app\.html/);
    });
  });

  describe('error path', () => {
    it('rejects whitespace-only path with an error string and does not dispatch', async () => {
      // Pre-fire the gate so the path-check is what we observe.
      markDone('c1');
      const cap = capture('agent-show-file');
      const t = showHtmlTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: '   ' }, ctx)) as string;
      cap.cleanup();
      expect(r).toMatch(/error/i);
      expect(cap.events).toHaveLength(0);
    });
  });
});
