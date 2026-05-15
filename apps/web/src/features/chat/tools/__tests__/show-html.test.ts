// show_html — agent-private file display (Phase 2 / A1).
// Dispatches `agent-show-file` CustomEvent with target='agent' so the host
// shell loads the file into the hidden agent-private iframe, NOT the user
// pane. Returns a confirmation string for the LLM.

import { describe, expect, it } from 'vitest';
import { showHtmlTool } from '../show-html';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface ShowDetail {
  filePath: string;
  viewportKey: string;
  target: 'user' | 'agent';
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
  describe('schema', () => {
    it('description mentions agent-private / your iframe', () => {
      const t = showHtmlTool({ getChatId: () => 'c1' });
      const desc = String(t.description).toLowerCase();
      expect(desc).toMatch(/agent|your iframe|private/);
    });

    it('requires non-empty path', () => {
      const t = showHtmlTool({ getChatId: () => 'c1' });
      expect(asSchema(t.inputSchema)?.safeParse({ path: '' }).success).toBe(false);
      expect(asSchema(t.inputSchema)?.safeParse({}).success).toBe(false);
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'app.html' }).success).toBe(true);
    });
  });

  describe('event dispatch', () => {
    it('dispatches agent-show-file with target=agent + chatId as viewportKey', async () => {
      const cap = capture('agent-show-file');
      const t = showHtmlTool({ getChatId: () => 'c1' });
      await t.execute!({ path: 'app.html' }, ctx);
      cap.cleanup();
      expect(cap.events).toEqual([
        { filePath: 'app.html', viewportKey: 'c1', target: 'agent' },
      ]);
    });

    it('returns a confirmation string mentioning the path', async () => {
      const t = showHtmlTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: 'app.html' }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/Opened app\.html/);
      expect(r).toMatch(/your iframe|agent/i);
    });
  });

  describe('error path', () => {
    it('rejects whitespace-only path with an error string', async () => {
      const cap = capture('agent-show-file');
      const t = showHtmlTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ path: '   ' }, ctx)) as string;
      cap.cleanup();
      expect(r).toMatch(/error/i);
      expect(cap.events).toHaveLength(0);
    });
  });
});
