import { afterEach, describe, expect, it } from 'vitest';
import { byokKey } from './byok-key';

afterEach(() => {
  localStorage.clear();
});

describe('byokKey (per-provider)', () => {
  it('starts with no key for any provider', () => {
    expect(byokKey.isSet('openrouter')).toBe(false);
    expect(byokKey.isSet('anthropic')).toBe(false);
    expect(byokKey.isSet('openai')).toBe(false);
    expect(byokKey.get('openrouter')).toBeNull();
  });

  it('persists per-provider keys independently', () => {
    byokKey.set('openrouter', 'sk-or-v1-test');
    byokKey.set('anthropic', 'sk-ant-test');
    byokKey.set('openai', 'sk-test');
    expect(byokKey.get('openrouter')).toBe('sk-or-v1-test');
    expect(byokKey.get('anthropic')).toBe('sk-ant-test');
    expect(byokKey.get('openai')).toBe('sk-test');
    expect(localStorage.getItem('open-design:llm-api-key:openrouter')).toBe('sk-or-v1-test');
    expect(localStorage.getItem('open-design:llm-api-key:anthropic')).toBe('sk-ant-test');
    expect(localStorage.getItem('open-design:llm-api-key:openai')).toBe('sk-test');
  });

  it('isSet is true only for the providers that have a key', () => {
    byokKey.set('anthropic', 'sk-ant-x');
    expect(byokKey.isSet('anthropic')).toBe(true);
    expect(byokKey.isSet('openrouter')).toBe(false);
    expect(byokKey.isSet('openai')).toBe(false);
  });

  it('trims whitespace on set', () => {
    byokKey.set('anthropic', '  sk-ant-trimmed  \n');
    expect(byokKey.get('anthropic')).toBe('sk-ant-trimmed');
  });

  it('clear() removes only the targeted provider', () => {
    byokKey.set('openrouter', 'sk-or');
    byokKey.set('anthropic', 'sk-ant');
    byokKey.clear('anthropic');
    expect(byokKey.get('anthropic')).toBeNull();
    expect(byokKey.isSet('anthropic')).toBe(false);
    expect(byokKey.get('openrouter')).toBe('sk-or');
    expect(byokKey.isSet('openrouter')).toBe(true);
  });

  // ─── Empty / whitespace must NOT count as "set" — same regression guard
  // as the pre-multi-provider version. Sending `Bearer ` to a provider
  // yields an opaque 401 instead of a clean "please set your key" prompt.

  it('isSet() returns false for empty string in storage', () => {
    localStorage.setItem('open-design:llm-api-key:openrouter', '');
    expect(byokKey.isSet('openrouter')).toBe(false);
  });

  it('isSet() returns false for whitespace-only string in storage', () => {
    localStorage.setItem('open-design:llm-api-key:openrouter', '   \n\t  ');
    expect(byokKey.isSet('openrouter')).toBe(false);
  });

  it('set() with empty string does not register as set', () => {
    byokKey.set('openrouter', '');
    expect(byokKey.isSet('openrouter')).toBe(false);
  });

  it('set() with whitespace-only string does not register as set', () => {
    byokKey.set('openrouter', '   \t\n');
    expect(byokKey.isSet('openrouter')).toBe(false);
  });

  // ─── Legacy single-key migration ───
  it('migrates a pre-multi-provider single-key to the openrouter slot on first read', () => {
    localStorage.setItem('open-design:llm-api-key', 'sk-or-legacy');
    expect(byokKey.get('openrouter')).toBe('sk-or-legacy');
    // Legacy slot is consumed so we don't keep migrating it back over
    // newer saves to other providers.
    expect(localStorage.getItem('open-design:llm-api-key')).toBeNull();
  });

  it('does not migrate when the openrouter slot is already set', () => {
    localStorage.setItem('open-design:llm-api-key:openrouter', 'sk-or-new');
    localStorage.setItem('open-design:llm-api-key', 'sk-or-legacy');
    expect(byokKey.get('openrouter')).toBe('sk-or-new');
    // Legacy is dropped to avoid future migration cycles.
    expect(localStorage.getItem('open-design:llm-api-key')).toBeNull();
  });
});
