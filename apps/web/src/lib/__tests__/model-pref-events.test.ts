import { describe, expect, it, vi } from 'vitest';
import { emitModelChange, subscribeModelChange } from '../model-pref-events';

describe('model-pref-events', () => {
  it('subscribers are called on emit', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    subscribeModelChange(fn1);
    subscribeModelChange(fn2);
    emitModelChange();
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
  it('unsubscribe stops further calls', () => {
    const fn = vi.fn();
    const unsub = subscribeModelChange(fn);
    emitModelChange();
    unsub();
    emitModelChange();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
