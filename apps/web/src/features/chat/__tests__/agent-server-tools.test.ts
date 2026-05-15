// Integration: createAgent must swap `web_fetch` for the provider-defined
// Anthropic server tool when provider=anthropic, and keep our client-side
// worker-proxy tool for everyone else (Phase 6 wire).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgent } from '../agent';

const NOOP_TODOS = () => {};

describe('createAgent provider-defined tool wiring', () => {
  beforeEach(() => {
    // getModelPref() reads from localStorage; default to anthropic-like model.
    localStorage.setItem('open-design.provider', 'anthropic');
    localStorage.setItem('open-design.model', 'claude-sonnet-4-6');
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('swaps web_fetch for the Anthropic server tool when provider=anthropic', () => {
    const agent = createAgent({
      projectId: 'p-x',
      apiKey: 'sk-fake',
      provider: 'anthropic',
      onTodosUpdate: NOOP_TODOS,
    });
    const tools = agent.tools as Record<string, { type?: string; id?: string }>;
    expect(tools.web_fetch).toBeDefined();
    expect(tools.web_fetch?.type).toBe('provider');
    expect(tools.web_fetch?.id).toMatch(/^anthropic\.web_fetch_\d+/);
  });

  it('keeps the client-side web_fetch tool for non-Anthropic providers', () => {
    const agent = createAgent({
      projectId: 'p-x',
      apiKey: 'sk-fake',
      provider: 'openai',
      onTodosUpdate: NOOP_TODOS,
    });
    const tools = agent.tools as Record<string, { type?: string; execute?: unknown }>;
    expect(tools.web_fetch).toBeDefined();
    // Client tool from `tool()` factory — no provider-defined marker, and
    // has an execute function (we ship it).
    expect(tools.web_fetch?.type).not.toBe('provider');
    expect(typeof tools.web_fetch?.execute).toBe('function');
  });
});
