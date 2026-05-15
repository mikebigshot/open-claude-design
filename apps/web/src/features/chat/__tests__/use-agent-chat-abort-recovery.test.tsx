// W1 §2.10 — abort + half-state recovery integration.
//
// When the user clicks Stop mid-turn, AI SDK leaves any partial tool parts
// in 'input-streaming' / 'input-available' states. The wrapped sendMessage
// runs recoverPartialState before the next send, replacing those with
// synthetic aborted tool_results so the next LLM call sees a valid shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TodosProvider } from '../todos-state';

interface UIPart {
  type: string;
  state?: string;
  output?: unknown;
  toolCallId?: string;
}

interface FakeChatHandle {
  id: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; parts: UIPart[] }>;
  sendMessage: ReturnType<typeof vi.fn>;
  status: 'ready' | 'streaming' | 'error' | 'submitted';
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
      const fn = updater as (m: typeof fakeChat.messages) => typeof fakeChat.messages;
      fakeChat.messages = fn(fakeChat.messages);
    } else {
      fakeChat.messages = updater as typeof fakeChat.messages;
    }
  }),
};

interface UseChatOptions {
  id?: string;
  transport?: unknown;
  onFinish?: (arg: { messages: unknown[] }) => void;
}

vi.mock('@ai-sdk/react', () => ({
  useChat: (options: UseChatOptions) => {
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

vi.mock('../agent', () => ({ createAgent: vi.fn(() => ({ __agent: true })) }));

vi.mock('@/lib/api', () => ({
  api: vi.fn(async (path: string, init?: { method?: string }) => {
    if (path.includes('/messages') && (init?.method ?? 'GET') === 'GET') {
      return { messages: [] };
    }
    return undefined;
  }),
}));

vi.mock('../verifier', async () => {
  const actual = await vi.importActual<typeof import('../verifier')>('../verifier');
  return { ...actual, spawnVerifier: vi.fn() };
});

import { useAgentChat } from '../use-agent-chat';

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
});

afterEach(() => {
  cleanup();
});

describe('useAgentChat — abort half-state recovery (§2.10)', () => {
  it('runs recoverPartialState before forwarding sendMessage', async () => {
    fakeChat.messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-write_file', state: 'input-streaming', toolCallId: 'tc-1' }],
      },
    ];
    fakeChat.status = 'ready';

    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );

    // Settle hydration effect (calls setMessages with a pass-through updater)
    // before observing the recovery-triggered call.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fakeChat.setMessages.mockClear();

    await act(async () => {
      await result.current.sendMessage({ text: 'continue' });
    });

    // setMessages was invoked to overwrite the partial tool part with
    // an output-available + aborted output.
    expect(fakeChat.setMessages).toHaveBeenCalled();
    const replaced = fakeChat.setMessages.mock.calls[0]![0] as Array<{
      role: string;
      parts: UIPart[];
    }>;
    expect(replaced[0]?.parts[0]?.state).toBe('output-available');
    expect(replaced[0]?.parts[0]?.output).toMatchObject({ aborted: true });

    // sendMessage was still forwarded.
    expect(fakeChat.sendMessage).toHaveBeenCalledWith({ text: 'continue' });
  });

  it('does not call setMessages from sendMessage path when there is no partial state to fix', async () => {
    fakeChat.messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_file',
            state: 'output-available',
            output: { ok: true },
            toolCallId: 'tc-1',
          },
        ],
      },
    ];

    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );

    // Wait for hydration effect to settle (it calls setMessages once with a
    // pass-through updater for the persisted thread).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fakeChat.setMessages.mockClear();

    await act(async () => {
      await result.current.sendMessage({ text: 'continue' });
    });

    expect(fakeChat.setMessages).not.toHaveBeenCalled();
  });
});
