// BYOK API key persistence — multi-provider.
//
// Stored in localStorage so the key survives reload but never leaves this
// browser. Worker (apps/api) never sees the key — chat path is browser-direct
// to the chosen provider.
//
// Storage layout (one key per provider):
//   open-design:llm-api-key:openrouter
//   open-design:llm-api-key:anthropic
//   open-design:llm-api-key:openai
//
// Legacy single-key (`open-design:llm-api-key`) is migrated to the
// `:openrouter` slot on first read — every existing user only ever set an
// OpenRouter key under that name.

import type { LLMProvider } from '@open-design/contracts';

const STORAGE_PREFIX = 'open-design:llm-api-key';
const LEGACY_KEY = STORAGE_PREFIX; // single-key form before multi-provider

function storageKey(provider: LLMProvider): string {
  return `${STORAGE_PREFIX}:${provider}`;
}

/** One-time migration: copy legacy single-key to the openrouter slot. */
function migrateLegacyOnce(): void {
  if (typeof localStorage === 'undefined') return;
  const newSlot = storageKey('openrouter');
  if (localStorage.getItem(newSlot) !== null) {
    // already migrated or user already set a new openrouter key
    if (localStorage.getItem(LEGACY_KEY) !== null) {
      // Both exist — drop the legacy copy so we don't keep migrating it
      // back over a fresh save. The :openrouter slot is authoritative.
      localStorage.removeItem(LEGACY_KEY);
    }
    return;
  }
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy && legacy.trim() !== '') {
    localStorage.setItem(newSlot, legacy.trim());
    localStorage.removeItem(LEGACY_KEY);
  }
}

export const byokKey = {
  get(provider: LLMProvider): string | null {
    if (typeof localStorage === 'undefined') return null;
    migrateLegacyOnce();
    return localStorage.getItem(storageKey(provider));
  },
  set(provider: LLMProvider, key: string): void {
    if (typeof localStorage === 'undefined') return;
    migrateLegacyOnce();
    // Trim first so an all-whitespace input doesn't pretend to be a key.
    // Empty trimmed value → treat as clear() (otherwise isSet() fallback
    // checks like `getItem(KEY) !== null` would re-trip the bug).
    const trimmed = key.trim();
    if (trimmed === '') {
      localStorage.removeItem(storageKey(provider));
      return;
    }
    localStorage.setItem(storageKey(provider), trimmed);
  },
  clear(provider: LLMProvider): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(storageKey(provider));
  },
  isSet(provider: LLMProvider): boolean {
    if (typeof localStorage === 'undefined') return false;
    migrateLegacyOnce();
    // Empty / whitespace must NOT count as "set" — sending a blank bearer
    // yields an opaque 401 instead of a clean "please set your key" prompt.
    const v = localStorage.getItem(storageKey(provider));
    return v !== null && v.trim() !== '';
  },
};

/**
 * Storage-event key prefix — exported so cross-tab listeners can filter
 * `storage` events to BYOK changes only.
 */
export const BYOK_STORAGE_PREFIX = STORAGE_PREFIX;
