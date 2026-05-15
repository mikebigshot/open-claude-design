import { beforeEach, describe, expect, it } from 'vitest';

import {
  _resetScreenshotPool,
  getScreenshotCapture,
  getScreenshotCaptureCount,
  getScreenshotCaptures,
  listScreenshotKeys,
  setScreenshotCaptures,
} from '../screenshot-pool.js';

describe('screenshot-pool', () => {
  beforeEach(() => {
    _resetScreenshotPool();
  });

  function blob(label: string): Blob {
    return new Blob([new Uint8Array([label.charCodeAt(0), label.charCodeAt(1) ?? 0])], {
      type: 'image/png',
    });
  }

  it('returns null for unset keys', () => {
    expect(getScreenshotCaptures('nope')).toBeNull();
    expect(getScreenshotCapture('nope', 0)).toBeNull();
    expect(getScreenshotCaptureCount('nope')).toBe(0);
  });

  it('writes + reads a single key', () => {
    setScreenshotCaptures('hero', [blob('a'), blob('b'), blob('c')]);
    expect(getScreenshotCaptureCount('hero')).toBe(3);
    expect(getScreenshotCapture('hero', 0)?.type).toBe('image/png');
    expect(getScreenshotCapture('hero', 2)?.type).toBe('image/png');
    expect(getScreenshotCapture('hero', 99)).toBeNull();
  });

  it('returns a defensive copy of the blob array', () => {
    setScreenshotCaptures('k', [blob('x')]);
    const arr = getScreenshotCaptures('k')!;
    arr.push(blob('z'));
    // Mutating the returned array MUST NOT mutate the pool entry.
    expect(getScreenshotCaptureCount('k')).toBe(1);
  });

  it('overwrites on re-set', () => {
    setScreenshotCaptures('k', [blob('a')]);
    expect(getScreenshotCaptureCount('k')).toBe(1);
    setScreenshotCaptures('k', [blob('b'), blob('c')]);
    expect(getScreenshotCaptureCount('k')).toBe(2);
  });

  it('enumerates keys in write order', () => {
    setScreenshotCaptures('first', [blob('1')]);
    // Force a future timestamp so the second key is written-strictly-after.
    const realNow = Date.now;
    Date.now = () => realNow() + 1000;
    setScreenshotCaptures('second', [blob('2')]);
    Date.now = realNow;
    expect(listScreenshotKeys()).toEqual(['first', 'second']);
  });
});
