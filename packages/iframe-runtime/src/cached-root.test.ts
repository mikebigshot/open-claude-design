import { describe, expect, it } from 'vitest';
import { patchCreateRootForReconcile } from './cached-root';

describe('patchCreateRootForReconcile', () => {
  it('returns a non-empty string', () => {
    const src = patchCreateRootForReconcile();
    expect(typeof src).toBe('string');
    expect(src.length).toBeGreaterThan(0);
  });

  it('wraps body in an IIFE', () => {
    const src = patchCreateRootForReconcile();
    expect(src.trim().startsWith('(function')).toBe(true);
    expect(src.trim().endsWith(')();')).toBe(true);
  });

  it('declares window.__codesign_tweaks__ for state sharing', () => {
    expect(patchCreateRootForReconcile()).toContain('window.__codesign_tweaks__');
  });

  it('intercepts window.ReactDOM.createRoot', () => {
    const src = patchCreateRootForReconcile();
    expect(src).toContain('window.ReactDOM.createRoot');
  });

  it('is idempotent (two calls return identical strings)', () => {
    expect(patchCreateRootForReconcile()).toBe(patchCreateRootForReconcile());
  });
});
