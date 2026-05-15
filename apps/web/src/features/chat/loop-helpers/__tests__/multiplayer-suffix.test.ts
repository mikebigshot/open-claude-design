// makeMultiplayerSuffix — §2.9 helper.
//
// v2 reference: main-agent-loop-full.raw.js — when more than one human
// participant is connected to the chat, the system prompt's tail gets
// extended with a "# Multiplayer session" section listing names.
// Verbatim wording from the bundle:
//
//   # Multiplayer session
//
//   This conversation has multiple human participants (Alice, Bob). User
//   messages may be prefixed with the author's name in square brackets
//   where the author is known. Treat each person's requests distinctly
//   and address them by name where it helps.
//
// W3 owns system-prompt/index.ts, so this helper just builds the suffix
// string. W3 will call it during merge to thread the suffix into block-2.

import { describe, expect, it } from 'vitest';
import { makeMultiplayerSuffix } from '../multiplayer-suffix';

describe('makeMultiplayerSuffix', () => {
  it('returns empty string for 0 participants', () => {
    expect(makeMultiplayerSuffix(new Map())).toBe('');
  });

  it('returns empty string for 1 participant (no need to flag multiplayer)', () => {
    const m = new Map([['user-uuid-1', 'Alice']]);
    expect(makeMultiplayerSuffix(m)).toBe('');
  });

  it('emits the verbatim multiplayer section for 2+ participants', () => {
    const m = new Map([
      ['uuid-1', 'Alice'],
      ['uuid-2', 'Bob'],
    ]);
    const out = makeMultiplayerSuffix(m);
    expect(out).toContain('# Multiplayer session');
    expect(out).toContain('Alice, Bob');
    // Verbatim narrative from v2:
    expect(out).toContain('multiple human participants');
    expect(out).toContain("prefixed with the author's name in square brackets");
    expect(out).toContain('Treat each person');
  });

  it('lists 3+ participants comma-separated in insertion order', () => {
    const m = new Map([
      ['uuid-1', 'Alice'],
      ['uuid-2', 'Bob'],
      ['uuid-3', 'Carol'],
    ]);
    expect(makeMultiplayerSuffix(m)).toContain('Alice, Bob, Carol');
  });

  it('deduplicates duplicate display names (same human in two tabs)', () => {
    const m = new Map([
      ['uuid-1', 'Alice'],
      ['uuid-2', 'Alice'],
      ['uuid-3', 'Bob'],
    ]);
    const out = makeMultiplayerSuffix(m);
    // We still ship the suffix because there are 2 distinct humans even
    // after dedup; the participant list is dedup'd display names.
    expect(out).toContain('Alice, Bob');
    // No 'Alice, Alice'.
    expect(out).not.toMatch(/Alice,\s*Alice/);
  });

  it('returns empty string when all participants share the same display name', () => {
    // Edge case: one user in two tabs is functionally NOT multiplayer; the
    // model shouldn't be told to address them by different names. v2's
    // check is `T.size > 1` after dedup of display names.
    const m = new Map([
      ['uuid-1', 'Alice'],
      ['uuid-2', 'Alice'],
    ]);
    expect(makeMultiplayerSuffix(m)).toBe('');
  });
});
