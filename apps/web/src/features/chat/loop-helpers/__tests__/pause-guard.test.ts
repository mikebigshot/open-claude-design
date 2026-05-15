// pause-guard — counter helper for §2.5 pause_turn handling.
//
// v2 reference: main-agent-loop-full.raw.js — `tN()` factory returns a
// counter with `tick()` (returns true when budget exhausted) and `reset()`.
// Used to prevent infinite pause_turn loops if a server-side tool keeps
// asking the agent to pause without ever completing.

import { describe, expect, it } from 'vitest';
import { makePauseGuard } from '../pause-guard';

describe('makePauseGuard', () => {
  it('defaults to max=3', () => {
    const guard = makePauseGuard();
    expect(guard.max).toBe(3);
  });

  it('respects custom max', () => {
    const guard = makePauseGuard({ max: 5 });
    expect(guard.max).toBe(5);
  });

  it('tick() returns false until count exceeds max, then true', () => {
    const guard = makePauseGuard({ max: 3 });
    expect(guard.tick()).toBe(false); // count=1
    expect(guard.tick()).toBe(false); // count=2
    expect(guard.tick()).toBe(false); // count=3
    expect(guard.tick()).toBe(true); // count=4 — over budget
  });

  it('reset() returns count to 0', () => {
    const guard = makePauseGuard({ max: 2 });
    guard.tick();
    guard.tick();
    guard.tick(); // exhausts
    guard.reset();
    expect(guard.tick()).toBe(false);
  });

  it('count is exposed for telemetry', () => {
    const guard = makePauseGuard({ max: 3 });
    expect(guard.count).toBe(0);
    guard.tick();
    expect(guard.count).toBe(1);
    guard.reset();
    expect(guard.count).toBe(0);
  });
});
