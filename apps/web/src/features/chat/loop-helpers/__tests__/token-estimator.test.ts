// estimateTokens — chars/4 token estimator used by §2.1 snip trigger and the
// `<system-reminder>` nudge. Anthropic's tokenizer averages ≈3.5–4 chars/token
// for English text + JSON; chars/4 is the v2 reference (see
// `wonderful-mendeleev-5231a7/.../artifacts/agent-loop/main-agent-loop-full.raw.js`
// — `w4` helper estimates message tokens from char counts).

import { describe, expect, it } from 'vitest';
import { estimateMessageTokens, estimateTokens } from '../token-estimator';

describe('estimateTokens', () => {
  it('returns 0 for an empty array', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('estimates a plain text message at chars/4', () => {
    // 40 chars → 10 tokens (ceil(40/4))
    const msg = { role: 'user', content: 'A'.repeat(40) } as const;
    expect(estimateTokens([msg])).toBe(10);
  });

  it('sums per-message estimates across an array', () => {
    const msgs = [
      { role: 'user' as const, content: 'A'.repeat(40) },
      { role: 'assistant' as const, content: 'B'.repeat(80) },
    ];
    // 10 + 20 = 30
    expect(estimateTokens(msgs)).toBe(30);
  });

  it('handles array content (multipart) by stringifying each part', () => {
    const msg = {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'A'.repeat(40) },
        { type: 'text' as const, text: 'B'.repeat(40) },
      ],
    };
    // The estimator stringifies each part — we just assert it's > 20 (combined
    // 80 chars of content alone) since JSON wrapping adds bookkeeping.
    expect(estimateTokens([msg])).toBeGreaterThanOrEqual(20);
  });

  it('handles tool-result content blocks', () => {
    const msg = {
      role: 'user' as const,
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: 'call-1',
          toolName: 'read_file',
          output: { type: 'text', value: 'C'.repeat(120) },
        },
      ],
    };
    // 120 chars / 4 = 30 minimum
    expect(estimateTokens([msg])).toBeGreaterThanOrEqual(30);
  });

  it('rounds up via ceil so a 1-char message is at least 1 token', () => {
    const msg = { role: 'user' as const, content: 'x' };
    expect(estimateMessageTokens(msg)).toBe(1);
  });

  it('estimateMessageTokens on null content returns 0', () => {
    // Synthetic shape used by ToolLoopAgent for tool blocks lacking explicit
    // content (e.g. assistant messages with only tool_use parts have content
    // arrays but each part is structured).
    const msg = { role: 'assistant' as const, content: [] };
    expect(estimateMessageTokens(msg)).toBe(0);
  });
});
