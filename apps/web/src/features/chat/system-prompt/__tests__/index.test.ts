import { describe, expect, it } from 'vitest';
import { buildSystemMessages } from '../index';
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

  it('defaults to attaching anthropic ephemeral cacheControl when provider is unspecified', () => {
    // Back-compat: pre-multi-provider call sites passed no `provider`. We
    // keep the anthropic cacheControl as the default so existing OpenRouter
    // → Anthropic flow doesn't lose its prompt-cache hit.
    const msgs = buildSystemMessages({ skills: [], designSystemId: undefined });
    for (const m of msgs) {
      expect(m.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    }
  });

  it('attaches anthropic cacheControl when provider=openrouter (OpenRouter forwards it)', () => {
    const msgs = buildSystemMessages({
      provider: 'openrouter',
      skills: [],
      designSystemId: undefined,
    });
    for (const m of msgs) {
      expect(m.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    }
  });

  it('attaches anthropic cacheControl when provider=anthropic (direct API supports it)', () => {
    const msgs = buildSystemMessages({
      provider: 'anthropic',
      skills: [],
      designSystemId: undefined,
    });
    for (const m of msgs) {
      expect(m.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    }
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
