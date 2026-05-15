// W1 §2.2 — sendMessage during streaming queues input + onFinish flushes
// the queue wrapped in <user_message> tags.
//
// We mirror the mock infrastructure of use-agent-chat.test.tsx. Keeping
// these tests in a separate file because adding the queue branch means we
// need to flip `fakeChat.status` between renders, which doesn't compose
// cleanly with the existing tests' expectations.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TodosProvider } from '../todos-state';

interface FakeChatHandle {
  id: string;
  messages: Array<{ id: string; role: string; parts: Array<{ type: string }> }>;
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
  setMessages: vi.fn(),
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

const spawnVerifierMock = vi.fn();
vi.mock('../verifier', async () => {
  const actual = await vi.importActual<typeof import('../verifier')>('../verifier');
  return { ...actual, spawnVerifier: (...args: unknown[]) => spawnVerifierMock(...args) };
});

import { useAgentChat } from '../use-agent-chat';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <TodosProvider>{children}</TodosProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  fakeChat.messages = [];
  fakeChat.sendMessage.mockReset().mockResolvedValue(undefined);
  fakeChat.setMessages.mockReset();
  fakeChat.status = 'ready';
  fakeChat.error = null;
  spawnVerifierMock.mockReset();
  lastUseChatOptions = {};
});

afterEach(() => {
  cleanup();
});

describe('useAgentChat — pending user message queue (§2.2)', () => {
  it('forwards sendMessage immediately when status is "ready" (not streaming)', async () => {
    fakeChat.status = 'ready';
    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );
    await act(async () => {
      await result.current.sendMessage({ text: 'hi' });
    });
    // Underlying sendMessage was called with the original message.
    expect(fakeChat.sendMessage).toHaveBeenCalledWith({ text: 'hi' });
    expect(fakeChat.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('queues the message instead when status is "streaming"', async () => {
    fakeChat.status = 'streaming';
    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );
    await act(async () => {
      await result.current.sendMessage({ text: 'queued-1' });
      await result.current.sendMessage({ text: 'queued-2' });
    });
    // Underlying chat.sendMessage NOT called — queue absorbed both.
    expect(fakeChat.sendMessage).not.toHaveBeenCalled();
  });

  it('flushes the queue on onFinish, wrapped in <user_message> tags', async () => {
    fakeChat.status = 'streaming';
    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );
    await act(async () => {
      await result.current.sendMessage({ text: 'queued-1' });
      await result.current.sendMessage({ text: 'queued-2' });
    });
    expect(fakeChat.sendMessage).not.toHaveBeenCalled();

    // Simulate onFinish (the wrapped onFinish should drain the queue).
    fakeChat.status = 'ready';
    await act(async () => {
      lastUseChatOptions.onFinish?.({ messages: [] });
    });

    await waitFor(() => expect(fakeChat.sendMessage).toHaveBeenCalledTimes(1));
    const arg = fakeChat.sendMessage.mock.calls[0]![0] as { text: string };
    expect(arg.text).toContain('<user_message>queued-1</user_message>');
    expect(arg.text).toContain('<user_message>queued-2</user_message>');
  });

  it('queue clears after flush — subsequent ready-state sends go through normally', async () => {
    fakeChat.status = 'streaming';
    const { result } = renderHook(
      () => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }),
      { wrapper },
    );
    await act(async () => {
      await result.current.sendMessage({ text: 'queued' });
    });
    fakeChat.status = 'ready';
    await act(async () => {
      lastUseChatOptions.onFinish?.({ messages: [] });
    });
    await waitFor(() => expect(fakeChat.sendMessage).toHaveBeenCalledTimes(1));

    // Now status is back to ready — next send should not double-queue.
    fakeChat.sendMessage.mockClear();
    await act(async () => {
      await result.current.sendMessage({ text: 'fresh' });
    });
    expect(fakeChat.sendMessage).toHaveBeenCalledWith({ text: 'fresh' });
  });

  it('does not flush on onFinish when queue is empty (no extra sendMessage)', async () => {
    fakeChat.status = 'ready';
    renderHook(() => useAgentChat({ projectId: 'p1', chatId: 'c1', fidelity: 'high' }), {
      wrapper,
    });
    await act(async () => {
      lastUseChatOptions.onFinish?.({ messages: [] });
    });
    expect(fakeChat.sendMessage).not.toHaveBeenCalled();
  });
});
