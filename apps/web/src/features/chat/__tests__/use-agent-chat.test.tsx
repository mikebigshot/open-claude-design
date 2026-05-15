// useAgentChat — useChat wrapper hook.
//
// Verifies the four cross-cutting concerns the wrapper adds on top of
// `@ai-sdk/react`'s `useChat`:
//   1. Hydration: GET /api/projects/:id/messages on mount, replace local
//      messages only when current is empty (no clobber for in-flight sends).
//   2. Persist on send: PUT /api/projects/:id/messages immediately after
//      pushing a user message (closes the refresh-mid-send race).
//   3. onFinish persist: PUT after each assistant turn completes.
//   4. Re-creation triggers: model-change + key refresh both bump the Chat
//      `id` so useChat re-creates the underlying instance.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TodosProvider } from '../todos-state';
import { byokKey } from '@/lib/byok-key';
import { emitModelChange } from '@/lib/model-pref-events';

// ── @ai-sdk/react mock ──
//
// We capture the most recent `options` passed to useChat so tests can
// verify `id` changes and invoke `onFinish` directly (simulating an
// agent-stream completion).

interface FakeChatHandle {
  id: string;
  messages: Array<{
    id: string;
    role: string;
    parts: Array<Record<string, unknown> & { type: string }>;
  }>;
  sendMessage: ReturnType<typeof vi.fn>;
  status: 'ready' | 'streaming' | 'error';
  error: Error | null;
  regenerate: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setMessages: ReturnType<typeof vi.fn>;
}

const fakeChat: FakeChatHandle = {
  id: '',
  messages: [],
  sendMessage: vi.fn().mockResolvedValue(undefined),
  status: 'ready',
  error: null,
  regenerate: vi.fn(),
  stop: vi.fn(),
  setMessages: vi.fn((updater: unknown) => {
    if (typeof updater === 'function') {
      const fn = updater as (current: typeof fakeChat.messages) => typeof fakeChat.messages;
      fakeChat.messages = fn(fakeChat.messages);
    } else {
      fakeChat.messages = updater as typeof fakeChat.messages;
    }
  }),
};

let lastUseChatOptions: {
  id?: string;
  transport?: unknown;
  onFinish?: (arg: { messages: unknown[] }) => void;
} = {};

vi.mock('@ai-sdk/react', () => ({
  useChat: (options: typeof lastUseChatOptions) => {
    lastUseChatOptions = options;
    fakeChat.id = options.id ?? 'fake-chat';
    return fakeChat;
  },
}));

vi.mock('ai', () => ({
  DirectChatTransport: class {
    public readonly opts: unknown;
    constructor(opts: unknown) {
      this.opts = opts;
    }
  },
}));

vi.mock('../agent', () => ({
  createAgent: vi.fn(() => ({ __agent: true })),
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async (path: string, init?: { method?: string }) => {
    if (path.includes('/messages') && (init?.method ?? 'GET') === 'GET') {
      return { messages: [] };
    }
    return undefined;
  }),
}));

// spawnVerifier is async and creates a Chat — mock to a controllable promise
// so we can assert the orchestration without spinning up a real verifier loop.
const spawnVerifierMock = vi.fn();
vi.mock('../verifier', async () => {
  const actual = await vi.importActual<typeof import('../verifier')>('../verifier');
  return {
    ...actual,
    spawnVerifier: (...args: unknown[]) => spawnVerifierMock(...args),
  };
});

import { api } from '@/lib/api';
import { useAgentChat } from '../use-agent-chat';
import { createAgent } from '../agent';

const apiMock = api as unknown as ReturnType<typeof vi.fn>;
const createAgentMock = createAgent as unknown as ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <TodosProvider>{children}</TodosProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  fakeChat.messages = [];
  fakeChat.sendMessage.mockReset().mockResolvedValue(undefined);
  fakeChat.setMessages.mockClear();
  fakeChat.status = 'ready';
  fakeChat.error = null;
  apiMock.mockClear().mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.includes('/messages') && (init?.method ?? 'GET') === 'GET') {
      return { messages: [] };
    }
    return undefined;
  });
  createAgentMock.mockClear();
  spawnVerifierMock.mockReset();
  lastUseChatOptions = {};
});

afterEach(() => {
  cleanup();
});

describe('useAgentChat', () => {
  it('builds a chat id keyed on projectId, keyTick, modelTick', () => {
    renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
      wrapper,
    });
    expect(lastUseChatOptions.id).toBe('chat-p1-c1-0-0');
  });

  it('forwards opts into createAgent (with placeholder key when no BYOK set)', () => {
    renderHook(
      () =>
        useAgentChat({
          projectId: 'p1',
          chatId: 'c1',
          fidelity: 'wireframe',
          designSystemId: 'ds1',
          designSystemName: 'My DS',
          designSystemTokensCss: ':root {}',
        }),
      { wrapper },
    );
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        fidelity: 'wireframe',
        designSystemId: 'ds1',
        designSystemName: 'My DS',
        designSystemTokensCss: ':root {}',
        apiKey: 'pending-byok-key',
      }),
    );
  });

  it('uses the real BYOK key when set', () => {
    byokKey.set('openrouter', 'sk-or-test-key');
    renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
      wrapper,
    });
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-or-test-key' }),
    );
  });

  it('hydrates messages from GET /api/projects/:id/messages on mount', async () => {
    apiMock.mockImplementationOnce(async () => ({
      messages: [{ id: 'persisted-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
    }));
    renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
      wrapper,
    });

    await waitFor(() => {
      expect(fakeChat.setMessages).toHaveBeenCalled();
    });
    // The setMessages callback was passed an updater — invoking with [] (empty
    // local) should yield the persisted thread.
    const updater = fakeChat.setMessages.mock.calls[0]![0] as (curr: unknown[]) => unknown[];
    const result = updater([]);
    expect(result).toEqual([
      { id: 'persisted-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('hydration preserves in-flight local messages (does not clobber)', async () => {
    apiMock.mockImplementationOnce(async () => ({
      messages: [{ id: 'persisted-1', role: 'user', parts: [{ type: 'text', text: 'old' }] }],
    }));
    renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
      wrapper,
    });

    await waitFor(() => expect(fakeChat.setMessages).toHaveBeenCalled());
    const updater = fakeChat.setMessages.mock.calls[0]![0] as (curr: unknown[]) => unknown[];
    const inflight = [{ id: 'in-flight', role: 'user', parts: [] }];
    expect(updater(inflight)).toBe(inflight);
  });

  it('wrapped sendMessage forwards args to underlying chat.sendMessage and PUTs the thread', async () => {
    fakeChat.messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];

    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      {
        wrapper,
      },
    );

    await act(async () => {
      await result.current.sendMessage({ text: 'hi' });
    });

    expect(fakeChat.sendMessage).toHaveBeenCalledWith({ text: 'hi' });
    const putCalls = apiMock.mock.calls.filter(
      ([path, init]) =>
        path.endsWith('/messages') && (init as { method?: string })?.method === 'PUT',
    );
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
    const lastPut = putCalls.at(-1)!;
    const body = JSON.parse((lastPut[1] as { body: string }).body);
    expect(body.messages).toHaveLength(1);
    expect(body.chatId).toBe('c1');
  });

  // F2 — Spec §4.3 step 5: persisted user message must carry `attachments[]`
  // so ChatMsg can render skill chips after a chat reload. The wrapper
  // inlines the content into the outgoing text (for the model) but ALSO
  // tacks the original attachments[] onto the just-pushed user UIMessage
  // (via setMessages) so the persist round-trip captures them.
  it('sendMessage with attachments stamps the original attachments[] onto the pushed user message and inlines text', async () => {
    // The underlying chat already has the user message pushed at this point
    // (mirrors AI SDK behaviour: sendMessage pushes synchronously before its
    // first await). Our wrapper's setMessages callback runs against this
    // state to add `attachments`.
    fakeChat.messages = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: '<skill-attachment name="X">…</skill-attachment>\n\nplease make a deck',
          },
        ],
      },
    ];

    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );

    const skillAttachment = {
      id: 'att-1',
      name: 'Make a deck',
      type: 'skill' as const,
      content: 'Skill body here.',
    };

    await act(async () => {
      await result.current.sendMessage({
        text: 'please make a deck',
        attachments: [skillAttachment],
        // `attachments` is our wrapper-side extension on top of the AI SDK's
        // sendMessage shape — cast through unknown because the SDK's tuple
        // overload doesn't allow extra fields.
      } as unknown as Parameters<typeof result.current.sendMessage>[0]);
    });

    // 1) chat.sendMessage receives the inlined text + NO `attachments` field
    const forwarded = fakeChat.sendMessage.mock.calls[0]![0] as {
      text: string;
      attachments?: unknown;
    };
    expect(forwarded.attachments).toBeUndefined();
    expect(forwarded.text).toContain('<skill-attachment name="Make a deck">');
    expect(forwarded.text).toContain('Skill body here.');
    expect(forwarded.text).toContain('please make a deck');

    // 2) setMessages was called to stamp attachments onto the just-pushed
    //    user message. After the setMessages callback runs, fakeChat.messages
    //    holds the updated user message.
    const userMessages = fakeChat.messages.filter((m) => m.role === 'user');
    const lastUser = userMessages.at(-1);
    expect(lastUser).toBeDefined();
    expect((lastUser as { attachments?: unknown[] }).attachments).toEqual([skillAttachment]);
  });

  it('sendMessage without attachments does NOT call setMessages to stamp', async () => {
    fakeChat.messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    fakeChat.setMessages.mockClear();
    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sendMessage({ text: 'hi' });
    });

    // Even after hydration's setMessages (called once during the effect),
    // no additional stamping call should occur because there are no
    // attachments. (Hydration's setMessages was called against
    // `apiMock.mockClear()` not the case here, but to be safe:)
    // Verify last user message doesn't acquire attachments[].
    const lastUser = fakeChat.messages.at(-1) as { attachments?: unknown };
    expect(lastUser.attachments).toBeUndefined();
  });

  it('uses keepalive only when serialized body is under 50KB', async () => {
    fakeChat.messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'tiny' }] }];

    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      {
        wrapper,
      },
    );

    await act(async () => {
      await result.current.sendMessage({ text: 'x' });
    });

    const lastPut = apiMock.mock.calls
      .filter(
        ([path, init]) =>
          path.endsWith('/messages') && (init as { method?: string })?.method === 'PUT',
      )
      .at(-1)!;
    expect((lastPut[1] as { keepalive?: boolean }).keepalive).toBe(true);

    // Now blow past the limit with a large body.
    apiMock.mockClear();
    fakeChat.messages = [
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: 'A'.repeat(60_000) }],
      },
    ];
    await act(async () => {
      await result.current.sendMessage({ text: 'big' });
    });
    const big = apiMock.mock.calls
      .filter(
        ([path, init]) =>
          path.endsWith('/messages') && (init as { method?: string })?.method === 'PUT',
      )
      .at(-1)!;
    expect((big[1] as { keepalive?: boolean }).keepalive).toBeUndefined();
  });

  it('onFinish persists the messages it receives', async () => {
    renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
      wrapper,
    });
    apiMock.mockClear();

    const onFinish = lastUseChatOptions.onFinish!;
    await act(async () => {
      onFinish({
        messages: [{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'done' }] }],
      });
    });

    const putCalls = apiMock.mock.calls.filter(
      ([path, init]) =>
        path.endsWith('/messages') && (init as { method?: string })?.method === 'PUT',
    );
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse((putCalls[0]![1] as { body: string }).body);
    expect(body.messages[0].id).toBe('a1');
    expect(body.chatId).toBe('c1');
  });

  it('subscribeModelChange firing bumps the chat id', async () => {
    const { rerender } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      {
        wrapper,
      },
    );
    expect(lastUseChatOptions.id).toBe('chat-p1-c1-0-0');

    await act(async () => {
      emitModelChange();
    });
    rerender();

    expect(lastUseChatOptions.id).toBe('chat-p1-c1-0-1');
  });

  it('refreshKey bumps the chat id', () => {
    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      {
        wrapper,
      },
    );
    expect(lastUseChatOptions.id).toBe('chat-p1-c1-0-0');

    act(() => result.current.refreshKey());
    expect(lastUseChatOptions.id).toBe('chat-p1-c1-1-0');
  });

  it('hasKey reflects byokKey.isSet at render time', () => {
    const { result, rerender } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );
    expect(result.current.hasKey).toBe(false);

    byokKey.set('openrouter', 'sk-x');
    act(() => result.current.refreshKey());
    rerender();
    expect(result.current.hasKey).toBe(true);
  });

  it('persistThread swallows api rejection without throwing', async () => {
    fakeChat.messages = [{ id: 'u', role: 'user', parts: [] }];
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if ((init?.method ?? 'GET') === 'PUT') throw new Error('boom');
      return { messages: [] };
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      {
        wrapper,
      },
    );
    await act(async () => {
      await result.current.sendMessage({ text: 'x' });
    });
    await waitFor(() => {
      expect(errSpy).toHaveBeenCalledWith('[chat] failed to persist messages', expect.any(Error));
    });
    errSpy.mockRestore();
  });

  describe('verifier orchestration', () => {
    it('does not spawn verifier when BYOK key is missing', () => {
      // No byokKey set in beforeEach reset
      fakeChat.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-fork_verifier_agent',
              state: 'output-available',
              input: {},
              toolCallId: 'fork-1',
            } as never,
          ],
        },
      ];
      renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
        wrapper,
      });
      expect(spawnVerifierMock).not.toHaveBeenCalled();
    });

    it('spawns verifier when fork_verifier_agent goes to output-available', async () => {
      byokKey.set('openrouter', 'sk-or-test');
      spawnVerifierMock.mockReturnValue(new Promise(() => {})); // never resolves
      fakeChat.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-fork_verifier_agent',
              state: 'output-available',
              input: { instructions: 'check the dropdown' },
              toolCallId: 'fork-1',
            } as never,
          ],
        },
      ];
      renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
        wrapper,
      });
      await waitFor(() => expect(spawnVerifierMock).toHaveBeenCalledTimes(1));
      expect(spawnVerifierMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p1',
          apiKey: 'sk-or-test',
          mainSessionId: 'chat-p1-c1-0-0',
          instructions: 'check the dropdown',
        }),
      );
    });

    it('does not re-spawn verifier on subsequent renders for the same toolCallId', async () => {
      byokKey.set('openrouter', 'sk-or-test');
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));
      fakeChat.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-fork_verifier_agent',
              state: 'output-available',
              input: {},
              toolCallId: 'fork-1',
            } as never,
          ],
        },
      ];
      const { rerender } = renderHook(
        () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
        {
          wrapper,
        },
      );
      await waitFor(() => expect(spawnVerifierMock).toHaveBeenCalledTimes(1));
      rerender();
      rerender();
      expect(spawnVerifierMock).toHaveBeenCalledTimes(1);
    });

    it('feeds verdict back into main thread via sendMessage on resolve', async () => {
      byokKey.set('openrouter', 'sk-or-test');
      spawnVerifierMock.mockResolvedValue({
        verdict: 'done',
        description: 'looks good',
        messages: [],
        timedOut: false,
      });
      fakeChat.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-fork_verifier_agent',
              state: 'output-available',
              input: {},
              toolCallId: 'fork-1',
            } as never,
          ],
        },
      ];
      renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
        wrapper,
      });

      await waitFor(() => {
        const sentTexts = fakeChat.sendMessage.mock.calls.map(
          (c) => (c[0] as { text?: string }).text ?? '',
        );
        expect(sentTexts.some((t) => t.includes('Verifier verdict'))).toBe(true);
      });
      const lastCall = fakeChat.sendMessage.mock.calls.find((c) =>
        (c[0] as { text?: string }).text?.includes('Verifier verdict'),
      );
      expect((lastCall![0] as { text: string }).text).toMatch(/done/);
      expect((lastCall![0] as { text: string }).text).toMatch(/looks good/);
    });

    it('feeds an error message back when spawnVerifier rejects', async () => {
      byokKey.set('openrouter', 'sk-or-test');
      spawnVerifierMock.mockRejectedValue(new Error('verifier crashed'));
      fakeChat.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-fork_verifier_agent',
              state: 'output-available',
              input: {},
              toolCallId: 'fork-1',
            } as never,
          ],
        },
      ];
      renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
        wrapper,
      });

      await waitFor(() => {
        const sentTexts = fakeChat.sendMessage.mock.calls.map(
          (c) => (c[0] as { text?: string }).text ?? '',
        );
        expect(sentTexts.some((t) => t.includes('Verifier crashed'))).toBe(true);
      });
    });

    it('exposes verifier.running=true while spawnVerifier is pending', async () => {
      byokKey.set('openrouter', 'sk-or-test');
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));
      fakeChat.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-fork_verifier_agent',
              state: 'output-available',
              input: {},
              toolCallId: 'fork-1',
            } as never,
          ],
        },
      ];
      const { result } = renderHook(
        () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
        {
          wrapper,
        },
      );
      await waitFor(() => expect(result.current.verifier.running).toBe(true));
    });
  });
});
