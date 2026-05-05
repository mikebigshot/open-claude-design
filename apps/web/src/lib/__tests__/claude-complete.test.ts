// claudeComplete — tests for the host-side fast-model RPC (used by the
// iframe's `window.claude.complete()`). After the multi-provider switch
// it routes through Vercel AI SDK's `streamText`, so we mock that instead
// of poking raw fetch + SSE wire frames.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeComplete } from '../claude-complete';
import { byokKey } from '../byok-key';
import { setModelPref } from '../model-pref';
import { streamText } from 'ai';

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, streamText: vi.fn() };
});

// The provider builders inside `llm-providers` are heavy SDK constructors;
// we don't need them to do anything real because `streamText` is mocked.
// Stub them so model construction never reaches out to network.
vi.mock('../llm-providers', () => ({
  buildFastModel: vi.fn(() => ({ __mockModel: 'fast' })),
  buildLanguageModel: vi.fn(() => ({ __mockModel: 'main' })),
}));

const streamTextMock = streamText as unknown as ReturnType<typeof vi.fn>;

function fakeStreamFromChunks(chunks: string[]) {
  return {
    textStream: (async function* () {
      for (const c of chunks) yield c;
    })(),
  };
}

beforeEach(() => {
  localStorage.clear();
  streamTextMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('claudeComplete', () => {
  it('rejects with provider-aware friendly message when current provider has no key', async () => {
    // Default provider is openrouter — no key → message names "OpenRouter".
    await expect(claudeComplete('hi', { onChunk: () => {} })).rejects.toThrow(
      /No OpenRouter API key configured/,
    );
  });

  it('mentions the active provider name in the no-key error', async () => {
    setModelPref({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
    await expect(claudeComplete('hi', { onChunk: () => {} })).rejects.toThrow(
      /No Anthropic API key configured/,
    );
    setModelPref({ provider: 'openai', modelId: 'gpt-4o-mini' });
    await expect(claudeComplete('hi', { onChunk: () => {} })).rejects.toThrow(
      /No OpenAI API key configured/,
    );
  });

  it('forwards textStream chunks to onChunk and resolves with the full concatenation', async () => {
    byokKey.set('openrouter', 'sk-or-test');
    streamTextMock.mockReturnValue(fakeStreamFromChunks(['Hello ', 'world']));

    const chunks: string[] = [];
    const full = await claudeComplete('say hi', { onChunk: (c) => chunks.push(c) });

    expect(chunks).toEqual(['Hello ', 'world']);
    expect(full).toBe('Hello world');
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const callArgs = streamTextMock.mock.calls[0]![0] as {
      prompt: string;
      maxOutputTokens: number;
    };
    expect(callArgs.prompt).toBe('say hi');
    expect(callArgs.maxOutputTokens).toBe(1024);
  });

  it('reads the BYOK key from the *currently selected* provider, not always openrouter', async () => {
    setModelPref({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
    byokKey.set('anthropic', 'sk-ant-test');
    // Even with an openrouter key sitting around, the anthropic key is the
    // one consulted because that's the active provider.
    byokKey.set('openrouter', 'sk-or-other');
    streamTextMock.mockReturnValue(fakeStreamFromChunks(['ok']));

    const out = await claudeComplete('p', { onChunk: () => {} });
    expect(out).toBe('ok');
  });

  it('propagates errors from the underlying stream', async () => {
    byokKey.set('openrouter', 'sk-or-test');
    streamTextMock.mockImplementation(() => ({
      textStream: (async function* () {
        yield 'partial';
        throw new Error('upstream broke');
      })(),
    }));

    await expect(claudeComplete('p', { onChunk: () => {} })).rejects.toThrow('upstream broke');
  });

  it('passes the user-provided AbortSignal through to streamText', async () => {
    byokKey.set('openrouter', 'sk-or-test');
    streamTextMock.mockReturnValue(fakeStreamFromChunks([]));
    const ctl = new AbortController();
    await claudeComplete('p', { onChunk: () => {} }, ctl.signal);
    const callArgs = streamTextMock.mock.calls[0]![0] as { abortSignal?: AbortSignal };
    expect(callArgs.abortSignal).toBe(ctl.signal);
  });
});
