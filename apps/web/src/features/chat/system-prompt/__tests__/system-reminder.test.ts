// buildSystemReminder — pure helper that returns the v2 <system-reminder>
// XML when context-token usage crosses a threshold. Caller (W1's prepareStep
// callback) decides WHEN to inject; this helper is just the string builder
// so we can test threshold + percentage rounding behaviour in isolation.
//
// v2 evidence: research/claude-design-v2/09-changes-vs-v1.md §9.3.2.
import { describe, expect, it } from 'vitest';
import { buildSystemReminder } from '../index';

describe('buildSystemReminder', () => {
  it('returns empty string when current tokens are below an explicit threshold', () => {
    expect(buildSystemReminder({ currentTokens: 5_000, threshold: 100_000 })).toBe('');
    expect(buildSystemReminder({ currentTokens: 0, threshold: 100_000 })).toBe('');
  });

  it('returns empty string at exactly the threshold (boundary: strict >)', () => {
    expect(buildSystemReminder({ currentTokens: 99_999, threshold: 100_000 })).toBe('');
    expect(buildSystemReminder({ currentTokens: 100_000, threshold: 100_000 })).toBe('');
  });

  it('returns the v2 reminder XML when tokens exceed the threshold', () => {
    const out = buildSystemReminder({
      currentTokens: 77_000,
      threshold: 70_000,
      maxTokens: 100_000,
    });
    expect(out).toContain('<system-reminder>');
    expect(out).toContain('</system-reminder>');
    expect(out).toContain('Context is at 77% of the working limit');
    expect(out).toContain('snip(from_id, to_id)');
    expect(out).toContain('Do not mention, acknowledge, or reference this reminder');
  });

  it('rounds the percentage to nearest integer', () => {
    const out = buildSystemReminder({
      currentTokens: 81_500,
      threshold: 70_000,
      maxTokens: 100_000,
    });
    expect(out).toContain('Context is at 82% of the working limit');
  });

  it('caps the reported percentage at 100', () => {
    const out = buildSystemReminder({
      currentTokens: 250_000,
      threshold: 70_000,
      maxTokens: 100_000,
    });
    expect(out).toContain('Context is at 100% of the working limit');
  });

  it('uses default threshold of 0.7 * maxTokens when only maxTokens is supplied', () => {
    // 71_000 / 100_000 = 71% which exceeds default 70% threshold.
    const out = buildSystemReminder({ currentTokens: 71_000, maxTokens: 100_000 });
    expect(out).toContain('<system-reminder>');
    expect(out).toContain('Context is at 71% of the working limit');
  });

  it('returns the pre-pressure (40%+) variant between 40% and 70% of maxTokens', () => {
    // 50_000 / 100_000 = 50%, between 40% pre-pressure and 70% main threshold.
    const out = buildSystemReminder({ currentTokens: 50_000, maxTokens: 100_000 });
    expect(out).toContain('<system-reminder>');
    expect(out).toContain('Context is at 50%');
    // Distinguish from the main reminder: pre-pressure uses softer wording.
    expect(out).toMatch(/Start registering snip|deferred|free to register/i);
  });

  it('returns empty string below the 40% pre-pressure floor', () => {
    // 30_000 / 100_000 = 30%, below the 40% pre-pressure cutoff.
    expect(buildSystemReminder({ currentTokens: 30_000, maxTokens: 100_000 })).toBe('');
  });

  it('returns empty string when neither threshold nor maxTokens is supplied (no signal)', () => {
    // Without a basis to compute a percentage, the reminder cannot be
    // formed honestly — caller should treat the empty string as "no-op".
    expect(buildSystemReminder({ currentTokens: 999_999 })).toBe('');
  });

  it('pre-pressure and main reminder are distinct strings', () => {
    const pre = buildSystemReminder({ currentTokens: 50_000, maxTokens: 100_000 });
    const main = buildSystemReminder({ currentTokens: 85_000, maxTokens: 100_000 });
    expect(pre).not.toBe(main);
    expect(main).toMatch(/end your turn/i);
    expect(pre).not.toMatch(/end your turn/i);
  });
});
