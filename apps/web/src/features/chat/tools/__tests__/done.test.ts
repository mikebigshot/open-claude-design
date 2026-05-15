import { describe, expect, it } from 'vitest';
import { doneTool } from '../done';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

// done's return text becomes the tool_result content the LLM sees BEFORE
// deciding its next step. Per Anthropic's official claude.ai/design bundle
// (research/claude-design-v2/artifacts/tool-implementations/done.js), the
// canonical return string ends with:
//
//   "Next: call fork_verifier_agent (or end your turn if this was a trivial tweak)."
//
// That nudge is the single biggest reason Sonnet/Opus reliably forks the
// verifier after `done`. Without it, smaller models (Haiku 4.5 — observed
// in e2e) skip the fork entirely. We mirror the wording verbatim so the
// behavior matches.

describe('done', () => {
  it('returns a string containing the supplied summary', async () => {
    const r = await doneTool().execute!({ summary: 'Built the landing page' }, ctx);
    expect(typeof r).toBe('string');
    expect(r as string).toContain('Built the landing page');
  });

  it('nudges fork_verifier_agent as the next step (verbatim from official)', async () => {
    const r = (await doneTool().execute!({ summary: 'x' }, ctx)) as string;
    expect(r).toContain(
      'Next: call fork_verifier_agent (or end your turn if this was a trivial tweak).',
    );
  });

  it('still nudges even when summary is missing or empty', async () => {
    const r1 = (await doneTool().execute!({}, ctx)) as string;
    const r2 = (await doneTool().execute!({ summary: '' }, ctx)) as string;
    expect(r1).toContain('fork_verifier_agent');
    expect(r2).toContain('fork_verifier_agent');
    // No dangling label when summary is empty
    expect(r1).not.toMatch(/Summary:\s*$/m);
    expect(r2).not.toMatch(/Summary:\s*$/m);
  });

  it('does not perform any network I/O', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('', { status: 200 });
    }) as typeof fetch;
    await doneTool().execute!({ summary: 'x' }, ctx);
    expect(fetchCalled).toBe(false);
  });

  it('handles long multi-line summary', async () => {
    const summary = 'Line 1\nLine 2\nLine 3';
    const r = (await doneTool().execute!({ summary }, ctx)) as string;
    expect(r).toContain(summary);
    expect(r).toContain('fork_verifier_agent');
  });
});
