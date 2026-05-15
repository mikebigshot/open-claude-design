// done-gate — per-chat Set tracking whether `done` has fired in the current
// session. Mirrors the official Claude Design `l6`/`fB` pair (research v2
// artifacts/agent-loop/verifier-tools-and-fork-boundary.raw.js): the
// `fork_verifier_agent` execute() uses `l6(chatId)` to refuse forks before a
// successful `done`, and the `done` execute() calls `fB(chatId)` to flip the
// gate only when the console-error scan comes back clean.
//
// The gate is module-level state (single Map in a browser tab). That mirrors
// official's `Tb`/equivalent — chatIds never collide across tabs because the
// app spawns separate agent instances per tab.

import { afterEach, describe, expect, it } from 'vitest';
import { clearDone, hasDoneFired, markDone, _resetDoneGate } from '../done-gate';

describe('done-gate', () => {
  afterEach(() => {
    _resetDoneGate();
  });

  it('hasDoneFired returns false before any markDone for the chat', () => {
    expect(hasDoneFired('chat-A')).toBe(false);
  });

  it('hasDoneFired returns true after markDone for that chat', () => {
    markDone('chat-A');
    expect(hasDoneFired('chat-A')).toBe(true);
  });

  it('isolates state across chat ids', () => {
    markDone('chat-A');
    expect(hasDoneFired('chat-A')).toBe(true);
    expect(hasDoneFired('chat-B')).toBe(false);
  });

  it('clearDone removes the flag for a specific chat', () => {
    markDone('chat-A');
    markDone('chat-B');
    clearDone('chat-A');
    expect(hasDoneFired('chat-A')).toBe(false);
    expect(hasDoneFired('chat-B')).toBe(true);
  });

  it('markDone is idempotent — second call leaves state unchanged', () => {
    markDone('chat-A');
    markDone('chat-A');
    expect(hasDoneFired('chat-A')).toBe(true);
    clearDone('chat-A');
    expect(hasDoneFired('chat-A')).toBe(false);
  });

  it('rejects empty / whitespace chatId to avoid silent gate leaks', () => {
    expect(() => markDone('')).toThrow();
    expect(() => markDone('   ')).toThrow();
    expect(hasDoneFired('')).toBe(false);
  });

  it('_resetDoneGate wipes the entire registry (test hook)', () => {
    markDone('chat-A');
    markDone('chat-B');
    _resetDoneGate();
    expect(hasDoneFired('chat-A')).toBe(false);
    expect(hasDoneFired('chat-B')).toBe(false);
  });
});
