// verifier.ts — spawnVerifier orchestrator + extractVerdict + formatVerdictForMain.
//
// Exercises:
//   1. extractVerdict / formatVerdictForMain (pure helpers — no mocks).
//   2. spawnVerifier — uses a fake `Chat` constructor that captures the
//      `onFinish` callback so the test can drive the verdict synchronously.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignAgentUIMessage } from '../ui-messages';

// ── @ai-sdk/react Chat mock ──
//
// We don't want to instantiate a real ChatStore (which needs network access).
// Instead, capture the constructor options so the test can:
//   - assert the verifier id ends in `::verifier`
//   - drive the onFinish callback to simulate completion

interface FakeChatHandle {
  id: string;
  options: {
    id: string;
    messages: DesignAgentUIMessage[];
    onFinish?: (arg: { messages: DesignAgentUIMessage[] }) => void;
    onError?: (err: unknown) => void;
  };
  messages: DesignAgentUIMessage[];
  sendMessage: ReturnType<typeof vi.fn>;
}

const fakeChats: FakeChatHandle[] = [];

vi.mock('@ai-sdk/react', () => ({
  Chat: class {
    public readonly id: string;
    public messages: DesignAgentUIMessage[];
    public sendMessage = vi.fn();
    public options: FakeChatHandle['options'];
    constructor(options: FakeChatHandle['options']) {
      this.id = options.id;
      this.messages = [...(options.messages ?? [])];
      this.options = options;
      fakeChats.push(this as unknown as FakeChatHandle);
    }
  },
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    DirectChatTransport: class {
      constructor(public readonly opts: unknown) {}
    },
  };
});

vi.mock('../agent', () => ({
  createAgent: vi.fn(() => ({ __agent: true })),
}));

import { spawnVerifier, extractVerdict, formatVerdictForMain } from '../verifier';
import { createAgent } from '../agent';

const createAgentMock = createAgent as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeChats.length = 0;
  createAgentMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const baseSpawnOpts = {
  projectId: 'p1',
  apiKey: 'sk-or-test',
  fidelity: 'high' as const,
  mainSessionId: 'main-session-uuid',
  mainMessages: [
    {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'build a counter' }],
    } as unknown as DesignAgentUIMessage,
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-fork_verifier_agent',
          state: 'output-available',
          input: {},
          output: { verifierSpawned: true },
          toolCallId: 'fork-call-1',
        } as unknown as Record<string, unknown>,
      ],
    } as unknown as DesignAgentUIMessage,
  ],
};

describe('extractVerdict', () => {
  it('returns null when no verification_feedback is present', () => {
    expect(extractVerdict([])).toBeNull();
    expect(
      extractVerdict([
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'thinking' }],
        } as unknown as DesignAgentUIMessage,
      ]),
    ).toBeNull();
  });

  it('extracts the most recent verdict when verification_feedback is present', () => {
    const messages = [
      {
        id: 'v1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-verification_feedback',
            state: 'output-available',
            input: { verdict: 'done', description: 'all good' },
            toolCallId: 'vf-1',
          } as unknown as Record<string, unknown>,
        ],
      } as unknown as DesignAgentUIMessage,
    ];
    const result = extractVerdict(messages);
    expect(result?.verdict).toBe('done');
    expect(result?.description).toBe('all good');
  });

  it('returns null for in-progress (not output-available) verification_feedback', () => {
    const messages = [
      {
        id: 'v1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-verification_feedback',
            state: 'input-available',
            input: { verdict: 'done', description: 'pending' },
            toolCallId: 'vf-1',
          } as unknown as Record<string, unknown>,
        ],
      } as unknown as DesignAgentUIMessage,
    ];
    expect(extractVerdict(messages)).toBeNull();
  });

  it('rejects unknown verdict values', () => {
    const messages = [
      {
        id: 'v1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-verification_feedback',
            state: 'output-available',
            input: { verdict: 'maybe', description: 'x' },
            toolCallId: 'vf-1',
          } as unknown as Record<string, unknown>,
        ],
      } as unknown as DesignAgentUIMessage,
    ];
    expect(extractVerdict(messages)).toBeNull();
  });

  it('walks newest → oldest, picks the latest verdict if multiple are present', () => {
    const messages = [
      {
        id: 'v1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-verification_feedback',
            state: 'output-available',
            input: { verdict: 'needs_work', description: 'old' },
            toolCallId: 'vf-1',
          } as unknown as Record<string, unknown>,
        ],
      } as unknown as DesignAgentUIMessage,
      {
        id: 'v2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-verification_feedback',
            state: 'output-available',
            input: { verdict: 'done', description: 'new' },
            toolCallId: 'vf-2',
          } as unknown as Record<string, unknown>,
        ],
      } as unknown as DesignAgentUIMessage,
    ];
    expect(extractVerdict(messages)?.description).toBe('new');
  });
});

describe('formatVerdictForMain', () => {
  it('formats a `done` verdict with the leading task-completed sentence', () => {
    const formatted = formatVerdictForMain({
      verdict: 'done',
      description: 'all good',
      messages: [],
      timedOut: false,
    });
    expect(formatted).toMatch(/A background task has completed/);
    expect(formatted).toMatch(/✅/);
    expect(formatted).toMatch(/done/);
    expect(formatted).toMatch(/all good/);
  });

  it('formats a `needs_work` verdict with a warning glyph', () => {
    const formatted = formatVerdictForMain({
      verdict: 'needs_work',
      description: 'Counter.jsx broken',
      messages: [],
      timedOut: false,
    });
    expect(formatted).toMatch(/⚠️/);
    expect(formatted).toMatch(/needs_work/);
    expect(formatted).toMatch(/Counter\.jsx broken/);
  });

  it('appends a timed-out note when verifier ran out of time', () => {
    const formatted = formatVerdictForMain({
      verdict: 'needs_work',
      description: 'no verdict',
      messages: [],
      timedOut: true,
    });
    expect(formatted).toMatch(/timed out|out of time|verdict synthesized/i);
  });

  it('falls back to "(no description)" when description is empty', () => {
    const formatted = formatVerdictForMain({
      verdict: 'done',
      description: '   ',
      messages: [],
      timedOut: false,
    });
    expect(formatted).toMatch(/no description/);
  });
});

describe('spawnVerifier', () => {
  it('creates a Chat with id `<mainSessionId>::verifier`', async () => {
    const promise = spawnVerifier(baseSpawnOpts);
    expect(fakeChats).toHaveLength(1);
    expect(fakeChats[0]!.id).toBe('main-session-uuid::verifier');

    // Drive the onFinish callback to terminate the verifier.
    fakeChats[0]!.options.onFinish!({
      messages: [
        {
          id: 'v1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-verification_feedback',
              state: 'output-available',
              input: { verdict: 'done', description: 'looks fine' },
              toolCallId: 'vf-1',
            } as unknown as Record<string, unknown>,
          ],
        } as unknown as DesignAgentUIMessage,
      ],
    });

    await expect(promise).resolves.toMatchObject({
      verdict: 'done',
      description: 'looks fine',
      timedOut: false,
    });
  });

  it('creates the verifier agent with mode="verifier" and same project/key', async () => {
    void spawnVerifier(baseSpawnOpts);
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        apiKey: 'sk-or-test',
        fidelity: 'high',
        mode: 'verifier',
      }),
    );
  });

  it('passes the main message history into the verifier Chat', () => {
    void spawnVerifier(baseSpawnOpts);
    expect(fakeChats[0]!.options.messages).toEqual(baseSpawnOpts.mainMessages);
  });

  it('kicks off the loop by sending FORK_BOUNDARY_PROMPT as the first user message', () => {
    void spawnVerifier(baseSpawnOpts);
    expect(fakeChats[0]!.sendMessage).toHaveBeenCalledTimes(1);
    const arg = fakeChats[0]!.sendMessage.mock.calls[0]![0] as { text: string };
    expect(arg.text).toMatch(/FORK BOUNDARY/);
    expect(arg.text).toMatch(/verification_feedback/);
  });

  it('includes optional instructions in the kickoff message', () => {
    void spawnVerifier({
      ...baseSpawnOpts,
      instructions: 'check the dropdown handles outside-click',
    });
    const arg = fakeChats[0]!.sendMessage.mock.calls[0]![0] as { text: string };
    expect(arg.text).toMatch(/check the dropdown/);
  });

  it('resolves with timedOut=true when no verdict arrives within timeoutMs', async () => {
    vi.useFakeTimers();
    const promise = spawnVerifier({ ...baseSpawnOpts, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(result.verdict).toBe('needs_work');
    expect(result.description).toMatch(/did not return a verdict|out of time/i);
  });

  it('resolves with synthetic needs_work when onError fires', async () => {
    const promise = spawnVerifier(baseSpawnOpts);
    fakeChats[0]!.options.onError!(new Error('rate limited'));
    const result = await promise;
    expect(result.verdict).toBe('needs_work');
    expect(result.description).toMatch(/rate limited/);
  });

  it('only resolves once even if multiple onFinish events fire', async () => {
    const promise = spawnVerifier(baseSpawnOpts);
    fakeChats[0]!.options.onFinish!({
      messages: [
        {
          id: 'v1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-verification_feedback',
              state: 'output-available',
              input: { verdict: 'done', description: 'first' },
              toolCallId: 'vf-1',
            } as unknown as Record<string, unknown>,
          ],
        } as unknown as DesignAgentUIMessage,
      ],
    });
    fakeChats[0]!.options.onFinish!({
      messages: [
        {
          id: 'v2',
          role: 'assistant',
          parts: [
            {
              type: 'tool-verification_feedback',
              state: 'output-available',
              input: { verdict: 'needs_work', description: 'second' },
              toolCallId: 'vf-2',
            } as unknown as Record<string, unknown>,
          ],
        } as unknown as DesignAgentUIMessage,
      ],
    });
    const result = await promise;
    expect(result.description).toBe('first');
  });
});
