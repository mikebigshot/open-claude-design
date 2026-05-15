// llm-providers — provider-capability matrix for Anthropic server tools
// (Phase 6). web_fetch routes server-side on Anthropic-routed providers,
// client-side via worker proxy elsewhere.

import { describe, expect, it } from 'vitest';
import { supportsServerTool, buildServerToolMap } from '../llm-providers';

describe('supportsServerTool', () => {
  it('reports web_fetch as server-supported on anthropic', () => {
    expect(supportsServerTool('web_fetch', 'anthropic')).toBe(true);
  });

  it('reports web_fetch as NOT server-supported on openai / google / others', () => {
    expect(supportsServerTool('web_fetch', 'openai')).toBe(false);
    expect(supportsServerTool('web_fetch', 'google')).toBe(false);
    expect(supportsServerTool('web_fetch', 'openrouter')).toBe(false);
  });

  it('returns false for unknown tools', () => {
    expect(supportsServerTool('does_not_exist', 'anthropic')).toBe(false);
  });
});

describe('buildServerToolMap', () => {
  it('returns a web_fetch entry for anthropic with provider-defined id', () => {
    const tools = buildServerToolMap('anthropic', 'sk-fake-key');
    expect(tools).toHaveProperty('web_fetch');
    // Anthropic provider-defined tool descriptor (Vercel AI SDK 6 marks
    // these with `type: 'provider'` and an id like `anthropic.web_fetch_*`).
    const t = tools.web_fetch as { type: string; id: string };
    expect(t.type).toBe('provider');
    expect(t.id).toMatch(/^anthropic\.web_fetch_\d+/);
  });

  it('returns an empty map for non-anthropic providers', () => {
    expect(buildServerToolMap('openai', 'sk-x')).toEqual({});
    expect(buildServerToolMap('google', 'sk-x')).toEqual({});
    expect(buildServerToolMap('openrouter', 'sk-x')).toEqual({});
  });
});
