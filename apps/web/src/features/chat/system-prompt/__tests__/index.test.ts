import { describe, expect, it } from 'vitest';
import { buildAnthropicProviderOptions, buildSystemMessages } from '../index';
import { BLOCK_1 } from '../block-1';

describe('buildSystemMessages', () => {
  it('returns two system messages: BLOCK_1 verbatim, then block-2', () => {
    const msgs = buildSystemMessages({ skills: [], designSystemId: undefined });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toBe(BLOCK_1);
    expect(msgs[1]?.role).toBe('system');
    expect(msgs[1]?.content).toContain('## Available Skills');
  });

  // ── v2 cache_control single-breakpoint contract ──────────────────────
  // Pre-2026-05-09 v1 capture put cache_control on BOTH system messages.
  // v2 capture (research/claude-design-v2/09-changes-vs-v1.md §9.2.1)
  // shows Anthropic only sets it on the LAST system message — the canonical
  // "single breakpoint" pattern. We move to that contract here. v1's
  // belief was a misread of the captured payload.
  it('attaches cacheControl only to the LAST system message by default (single breakpoint)', () => {
    const msgs = buildSystemMessages({ skills: [], designSystemId: undefined });
    expect(msgs[0]?.providerOptions?.anthropic?.cacheControl).toBeUndefined();
    expect(msgs[msgs.length - 1]?.providerOptions?.anthropic?.cacheControl).toEqual({
      type: 'ephemeral',
    });
  });

  it('openrouter routes through anthropic — single breakpoint on the LAST message', () => {
    const msgs = buildSystemMessages({
      provider: 'openrouter',
      skills: [],
      designSystemId: undefined,
    });
    expect(msgs[0]?.providerOptions?.anthropic?.cacheControl).toBeUndefined();
    expect(msgs[msgs.length - 1]?.providerOptions?.anthropic?.cacheControl).toEqual({
      type: 'ephemeral',
    });
  });

  it('anthropic direct: single breakpoint on the LAST system message', () => {
    const msgs = buildSystemMessages({
      provider: 'anthropic',
      skills: [],
      designSystemId: undefined,
    });
    expect(msgs[0]?.providerOptions?.anthropic?.cacheControl).toBeUndefined();
    expect(msgs[msgs.length - 1]?.providerOptions?.anthropic?.cacheControl).toEqual({
      type: 'ephemeral',
    });
  });

  it('omits providerOptions entirely when provider=openai (no equivalent feature)', () => {
    const msgs = buildSystemMessages({
      provider: 'openai',
      skills: [],
      designSystemId: undefined,
    });
    for (const m of msgs) {
      expect(m.providerOptions).toBeUndefined();
    }
  });
});

// ── buildAnthropicProviderOptions ─────────────────────────────────────────
// W3-owned helper that produces the per-call providerOptions.anthropic block
// W1 will spread into ToolLoopAgent / streamText. v2 capture
// (research/claude-design-v2/09-changes-vs-v1.md §9.3.1) shows
// claude.ai/design baselines on adaptive thinking + effort=high.
describe('buildAnthropicProviderOptions', () => {
  it('returns adaptive thinking + high effort by default', () => {
    const opts = buildAnthropicProviderOptions();
    expect(opts.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
    expect(opts.output_config).toEqual({ effort: 'high' });
  });

  it('respects an explicit effort override', () => {
    const opts = buildAnthropicProviderOptions({ effort: 'medium' });
    expect(opts.output_config).toEqual({ effort: 'medium' });
    expect(opts.thinking).toEqual({ type: 'adaptive', display: 'omitted' });
  });

  it('allows callers to disable adaptive thinking explicitly', () => {
    const opts = buildAnthropicProviderOptions({ adaptiveThinking: false });
    expect(opts.thinking).toBeUndefined();
    expect(opts.output_config).toEqual({ effort: 'high' });
  });

  it('accepts effort=low / max edge values per v2 bundle grep', () => {
    expect(buildAnthropicProviderOptions({ effort: 'low' }).output_config).toEqual({
      effort: 'low',
    });
    expect(buildAnthropicProviderOptions({ effort: 'max' }).output_config).toEqual({
      effort: 'max',
    });
  });
});
