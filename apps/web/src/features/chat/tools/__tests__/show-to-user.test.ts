// show_to_user — user-pane file display (Phase 2 / A1). Switches the user's
// tab bar to the named file. Dispatches `agent-show-file` with target='user'
// (matches the official `done.execute` event but doesn't run a console scan
// or flip any gate — it's a UI-only surface).

import { describe, expect, it } from 'vitest';
import { showToUserTool } from '../show-to-user';
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

describe('show_to_user', () => {
  it('description mentions user / tab bar', () => {
    const t = showToUserTool({ getChatId: () => 'c1' });
    const desc = String(t.description).toLowerCase();
    expect(desc).toMatch(/user/);
    expect(desc).toMatch(/tab bar|switch/);
  });

  it('rejects empty path', () => {
    const t = showToUserTool({ getChatId: () => 'c1' });
    expect(asSchema(t.inputSchema)?.safeParse({ path: '' }).success).toBe(false);
    expect(asSchema(t.inputSchema)?.safeParse({ path: 'app.html' }).success).toBe(true);
  });

  it('dispatches agent-show-file with target=user', async () => {
    const cap = capture('agent-show-file');
    const t = showToUserTool({ getChatId: () => 'c1' });
    await t.execute!({ path: 'app.html' }, ctx);
    cap.cleanup();
    expect(cap.events).toEqual([
      { filePath: 'app.html', viewportKey: 'c1', target: 'user' },
    ]);
  });

  it("returns 'Opened ... in the user's tab bar.' string", async () => {
    const t = showToUserTool({ getChatId: () => 'c1' });
    const r = (await t.execute!({ path: 'index.html' }, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toMatch(/Opened index\.html/);
    expect(r).toMatch(/tab bar|user/i);
  });

  it("does NOT flip the done-gate (unlike `done`)", async () => {
    // show_to_user is a pure UI nudge — verifier-fork must still require
    // an explicit `done` call.
    const { hasDoneFired, _resetDoneGate } = await import('../../lib/done-gate');
    _resetDoneGate();
    const t = showToUserTool({ getChatId: () => 'c1' });
    await t.execute!({ path: 'app.html' }, ctx);
    expect(hasDoneFired('c1')).toBe(false);
  });
});
