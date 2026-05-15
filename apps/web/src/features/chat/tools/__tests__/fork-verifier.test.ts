// fork_verifier_agent — inline spawn via main-loop registry.
//
// Aligns with official Claude Design (research v2 §10.5 + §14): the verifier
// is spawned INSIDE the tool's execute(), gated by a main-loop snapshot
// guard + a per-chat verifier-running guard. Reload / hydration / stale
// renders can't reach a registered main loop, so this tool simply errors
// out in those cases — no LLM request is made.

import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { forkVerifierTool } from '../fork-verifier';
import { isAsyncToolResult } from '../../loop-helpers/async-dispatch';
import * as verifierModule from '../../verifier';
import {
  registerMainLoop,
  tryAcquireVerifier,
  releaseVerifier,
  isVerifierRunning,
  _resetMainLoopRegistry,
  type MainLoopSnapshot,
} from '../../main-loop-registry';

// Mock spawnVerifier so we don't actually hit any network. Each test sets
// the resolution explicitly.
vi.mock('../../verifier', async () => {
  const actual = await vi.importActual<typeof import('../../verifier')>('../../verifier');
  return {
    ...actual,
    spawnVerifier: vi.fn(),
  };
});

const spawnVerifierMock = verifierModule.spawnVerifier as unknown as Mock;

interface OkResult {
  __async: true;
  _toolName: string;
  _label: string;
  placeholder: string;
}
interface ErrResult {
  isError: true;
  content: string;
}
type ExecuteResult = OkResult | ErrResult;

interface ToolWithExecute {
  description: string;
  inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
  execute?: (
    input: { task?: string },
    opts?: { abortSignal?: AbortSignal },
  ) => Promise<ExecuteResult>;
}

function snapshot(overrides: Partial<MainLoopSnapshot> = {}): MainLoopSnapshot {
  return {
    projectId: 'p1',
    apiKey: 'sk-test',
    provider: 'openrouter',
    fidelity: 'high',
    designSystemId: 'none',
    designSystemName: undefined,
    designSystemTokensCss: undefined,
    mainSessionId: 'main-session-1',
    messages: [],
    onVerdict: vi.fn(),
    onError: vi.fn(),
    onSpawnStart: vi.fn(),
    ...overrides,
  };
}

function getChatIdConst(id: string | null): () => string | null {
  return () => id;
}

describe('forkVerifierTool', () => {
  beforeEach(() => {
    _resetMainLoopRegistry();
    spawnVerifierMock.mockReset();
  });

  describe('input schema', () => {
    it('exposes a non-empty description mentioning fork_verifier semantics', () => {
      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      expect(t.description).toBeTruthy();
      expect(t.description.toLowerCase()).toMatch(/verifier|verify/);
    });

    it('accepts an empty input', () => {
      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      expect(t.inputSchema?.safeParse({}).success).toBe(true);
    });

    it('accepts a `task` string', () => {
      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      expect(t.inputSchema?.safeParse({ task: 'check the dropdown' }).success).toBe(true);
    });

    it('rejects non-string task', () => {
      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      expect(t.inputSchema?.safeParse({ task: 42 }).success).toBe(false);
    });
  });

  describe('guards', () => {
    it('returns isError when no active chatId at execute time', async () => {
      const t = forkVerifierTool({
        getChatId: getChatIdConst(null),
      }) as unknown as ToolWithExecute;
      const result = (await t.execute!({})) as ErrResult;
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/no active chat/i);
      expect(spawnVerifierMock).not.toHaveBeenCalled();
    });

    it('returns isError when main loop is not registered for the chat (mount / hydration / reload)', async () => {
      // This is THE bug fix: a tool execute without a registered main loop
      // means we're not currently in a turn — must NOT spawn anything.
      const t = forkVerifierTool({
        getChatId: getChatIdConst('c-unregistered'),
      }) as unknown as ToolWithExecute;
      const result = (await t.execute!({})) as ErrResult;
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/snapshot unavailable/i);
      expect(spawnVerifierMock).not.toHaveBeenCalled();
    });

    it('returns isError when a verifier is already running for the same chat viewport', async () => {
      const snap = snapshot();
      registerMainLoop('c1', () => snap);
      // Simulate a prior fork that's still running.
      expect(tryAcquireVerifier('c1::verifier')).toBe(true);

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      const result = (await t.execute!({})) as ErrResult;

      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/already running/i);
      expect(spawnVerifierMock).not.toHaveBeenCalled();

      // Cleanup so other tests start clean.
      releaseVerifier('c1::verifier');
    });

    it('release of the prior fork allows the next execute to spawn', async () => {
      const snap = snapshot();
      registerMainLoop('c1', () => snap);
      tryAcquireVerifier('c1::verifier');
      releaseVerifier('c1::verifier');

      spawnVerifierMock.mockReturnValue(new Promise(() => {})); // never resolves
      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      const result = (await t.execute!({})) as OkResult;

      expect(isAsyncToolResult(result)).toBe(true);
      expect(spawnVerifierMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('spawn dispatch', () => {
    it('calls spawnVerifier with snapshot fields when registered', async () => {
      const snap = snapshot({
        projectId: 'p-XYZ',
        apiKey: 'sk-ABC',
        provider: 'openrouter',
        mainSessionId: 'sess-42',
        messages: [{ id: 'm1', role: 'user', parts: [] }] as never,
      });
      registerMainLoop('c1', () => snap);
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      await t.execute!({ task: 'check spacing' });

      expect(spawnVerifierMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'p-XYZ',
          apiKey: 'sk-ABC',
          provider: 'openrouter',
          mainSessionId: 'sess-42',
          instructions: 'check spacing',
        }),
      );
      const mainMessages = spawnVerifierMock.mock.calls[0]![0].mainMessages;
      expect(mainMessages).toHaveLength(1);
    });

    it('passes undefined instructions when task is omitted or whitespace', async () => {
      registerMainLoop('c1', () => snapshot());
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));
      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;

      await t.execute!({});
      expect(spawnVerifierMock.mock.calls[0]![0].instructions).toBeUndefined();
      spawnVerifierMock.mockClear();
      releaseVerifier('c1::verifier');

      await t.execute!({ task: '   ' });
      expect(spawnVerifierMock.mock.calls[0]![0].instructions).toBeUndefined();
    });

    it('fires onSpawnStart synchronously before returning the placeholder', async () => {
      const onSpawnStart = vi.fn();
      registerMainLoop('c1', () => snapshot({ onSpawnStart }));
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      await t.execute!({});

      expect(onSpawnStart).toHaveBeenCalledTimes(1);
    });

    it('reads chatId via the lazy getter at execute time (not at tool-build time)', async () => {
      const snapA = snapshot({ apiKey: 'sk-A', mainSessionId: 'main-A' });
      const snapB = snapshot({ apiKey: 'sk-B', mainSessionId: 'main-B' });
      registerMainLoop('chat-A', () => snapA);
      registerMainLoop('chat-B', () => snapB);
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));

      let currentChatId: string = 'chat-A';
      const t = forkVerifierTool({
        getChatId: () => currentChatId,
      }) as unknown as ToolWithExecute;

      await t.execute!({});
      expect(spawnVerifierMock.mock.calls[0]![0].apiKey).toBe('sk-A');
      releaseVerifier('chat-A::verifier');

      currentChatId = 'chat-B';
      await t.execute!({});
      expect(spawnVerifierMock.mock.calls[1]![0].apiKey).toBe('sk-B');
    });
  });

  describe('verdict feedback wiring', () => {
    it('invokes snapshot.onVerdict when spawnVerifier resolves', async () => {
      const onVerdict = vi.fn();
      registerMainLoop('c1', () => snapshot({ onVerdict }));

      const verdict = {
        verdict: 'done' as const,
        description: 'all good',
        messages: [],
        timedOut: false,
      };
      spawnVerifierMock.mockResolvedValue(verdict);

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      await t.execute!({});

      await vi.waitFor(() => {
        expect(onVerdict).toHaveBeenCalledWith(verdict);
      });
    });

    it('invokes snapshot.onError when spawnVerifier rejects', async () => {
      const onError = vi.fn();
      registerMainLoop('c1', () => snapshot({ onError }));

      spawnVerifierMock.mockRejectedValue(new Error('boom'));

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      await t.execute!({});

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.any(Error));
      });
      const err = onError.mock.calls[0]![0] as Error;
      expect(err.message).toBe('boom');
    });

    it('releases the verifier viewport lock after resolve so next fork can fire', async () => {
      registerMainLoop('c1', () => snapshot());
      spawnVerifierMock.mockResolvedValue({
        verdict: 'done',
        description: 'ok',
        messages: [],
        timedOut: false,
      });

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      await t.execute!({});

      await vi.waitFor(() => {
        expect(isVerifierRunning('c1::verifier')).toBe(false);
      });
    });

    it('releases the verifier viewport lock after reject as well', async () => {
      registerMainLoop('c1', () => snapshot());
      spawnVerifierMock.mockRejectedValue(new Error('boom'));

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      await t.execute!({});

      await vi.waitFor(() => {
        expect(isVerifierRunning('c1::verifier')).toBe(false);
      });
    });
  });

  describe('placeholder protocol (v2 __async)', () => {
    it('execute returns an __async-tagged spec with _toolName / _label / placeholder', async () => {
      registerMainLoop('c1', () => snapshot());
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      const result = (await t.execute!({})) as OkResult;

      expect(isAsyncToolResult(result)).toBe(true);
      expect(result.__async).toBe(true);
      expect(result._toolName).toBe('fork_verifier_agent');
      expect(result._label).toMatch(/verifier/i);
      expect(typeof result.placeholder).toBe('string');
    });

    it('full-sweep placeholder is the v2 verbatim "no news is good news" string', async () => {
      registerMainLoop('c1', () => snapshot());
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      const result = (await t.execute!({})) as OkResult;
      expect(result.placeholder).toContain('Verifier subagent forked');
      expect(result.placeholder).toContain('running in the background');
      expect(result.placeholder).toContain('NOT the fork');
      expect(result.placeholder).toContain('still the main agent');
      expect(result.placeholder).toContain('End your turn');
    });

    it('placeholder narrative shifts when task is provided (directed-check mode)', async () => {
      registerMainLoop('c1', () => snapshot());
      spawnVerifierMock.mockReturnValue(new Promise(() => {}));

      const t = forkVerifierTool({ getChatId: getChatIdConst('c1') }) as unknown as ToolWithExecute;
      const result = (await t.execute!({ task: 'check spacing' })) as OkResult;
      expect(result.placeholder).toMatch(/directed|always report|regardless/i);
    });
  });
});
