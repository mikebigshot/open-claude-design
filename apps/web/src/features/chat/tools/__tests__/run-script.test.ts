// run_script — sandbox iframe + RPC. Tests use a DI'd runInSandbox so the
// iframe pipeline isn't required (full pipeline integration is browser-only).

import { describe, expect, it } from 'vitest';
import {
  runScriptTool,
  SANDBOX_ATTRIBUTE,
  SANDBOX_SRCDOC,
  isTrustedSandboxEvent,
  DEFAULT_TIMEOUT_MS,
  clampTimeout,
} from '../run-script';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('run_script', () => {
  it('description mentions sandbox + readFile / saveFile / ls helpers', () => {
    const t = runScriptTool('p');
    const desc = String(t.description).toLowerCase();
    expect(desc).toMatch(/sandbox/);
    expect(desc).toMatch(/readfile/i);
    expect(desc).toMatch(/savefile/i);
    expect(desc).toMatch(/ls/);
  });

  it('rejects empty code', () => {
    const t = runScriptTool('p');
    expect(asSchema(t.inputSchema)?.safeParse({ code: '' }).success).toBe(false);
  });

  it('formats logs + filesWritten into a structured string', async () => {
    const t = runScriptTool('p', {
      runInSandbox: async () => ({
        logs: ['hello', '[warn] careful'],
        filesWritten: ['out.txt', 'log.md'],
      }),
    });
    const r = (await t.execute!({ code: 'console.log("hello")' }, ctx)) as string;
    expect(r).toMatch(/Logs:/);
    expect(r).toContain('hello');
    expect(r).toContain('[warn] careful');
    expect(r).toMatch(/Files written:/);
    expect(r).toContain('- out.txt');
    expect(r).toContain('- log.md');
  });

  it('surfaces sandbox error in the output', async () => {
    const t = runScriptTool('p', {
      runInSandbox: async () => ({
        logs: ['partial'],
        filesWritten: [],
        error: 'TypeError: x is not a function',
      }),
    });
    const r = (await t.execute!({ code: 'bad()' }, ctx)) as string;
    expect(r).toMatch(/Error: TypeError: x is not a function/);
    expect(r).toContain('partial');
  });

  it('returns "(script ran with no output)" when sandbox emits nothing', async () => {
    const t = runScriptTool('p', {
      runInSandbox: async () => ({ logs: [], filesWritten: [] }),
    });
    const r = (await t.execute!({ code: 'void 0;' }, ctx)) as string;
    expect(r).toBe('(script ran with no output)');
  });

  it('forwards projectId + code + abortSignal to the sandbox runner', async () => {
    let captured: {
      projectId?: string;
      code?: string;
      hasSignal?: boolean;
    } = {};
    const ctrl = new AbortController();
    const t = runScriptTool('proj-X', {
      runInSandbox: async (projectId, code, _timeout, signal) => {
        captured = { projectId, code, hasSignal: signal === ctrl.signal };
        return { logs: [], filesWritten: [] };
      },
    });
    await t.execute!({ code: 'await ls()' }, { ...ctx, abortSignal: ctrl.signal });
    expect(captured.projectId).toBe('proj-X');
    expect(captured.code).toBe('await ls()');
    expect(captured.hasSignal).toBe(true);
  });

  // ── US-002 sandbox hardening ──
  describe('sandbox hardening', () => {
    it('sandbox attribute is exactly "allow-scripts" — no allow-same-origin / popups / top-navigation / forms / modals', () => {
      expect(SANDBOX_ATTRIBUTE).toBe('allow-scripts');
      expect(SANDBOX_ATTRIBUTE).not.toMatch(/allow-same-origin/);
      expect(SANDBOX_ATTRIBUTE).not.toMatch(/allow-top-navigation/);
      expect(SANDBOX_ATTRIBUTE).not.toMatch(/allow-popups/);
      expect(SANDBOX_ATTRIBUTE).not.toMatch(/allow-forms/);
      expect(SANDBOX_ATTRIBUTE).not.toMatch(/allow-modals/);
    });

    it('RPC request IDs use crypto.randomUUID() (not an incrementing counter)', () => {
      // The srcdoc body must use crypto.randomUUID so adversarial pages
      // can't guess the next id and inject a spoofed rpc:result.
      expect(SANDBOX_SRCDOC).toMatch(/crypto\.randomUUID\(\)/);
      expect(SANDBOX_SRCDOC).not.toMatch(/\+\+rpcSeq/);
    });

    it('isTrustedSandboxEvent rejects events whose source is not the sandbox iframe', () => {
      // Build a fake iframe handle whose contentWindow is a stub.
      const fakeWindow = {} as Window;
      const fakeIframe = { contentWindow: fakeWindow } as unknown as HTMLIFrameElement;
      const fromOther = {
        source: {} as Window,
        origin: 'null',
        data: { type: 'done' },
      } as unknown as MessageEvent;
      expect(isTrustedSandboxEvent(fromOther, fakeIframe)).toBe(false);
    });

    it('isTrustedSandboxEvent rejects events with a non-null origin (sandboxed srcdoc must report origin="null")', () => {
      const fakeWindow = {} as Window;
      const fakeIframe = { contentWindow: fakeWindow } as unknown as HTMLIFrameElement;
      const evWithBadOrigin = {
        source: fakeWindow,
        origin: 'https://evil.example',
        data: { type: 'done' },
      } as unknown as MessageEvent;
      expect(isTrustedSandboxEvent(evWithBadOrigin, fakeIframe)).toBe(false);
    });

    it('isTrustedSandboxEvent accepts the canonical sandbox event (source=contentWindow, origin="null")', () => {
      const fakeWindow = {} as Window;
      const fakeIframe = { contentWindow: fakeWindow } as unknown as HTMLIFrameElement;
      const ev = {
        source: fakeWindow,
        origin: 'null',
        data: { type: 'done' },
      } as unknown as MessageEvent;
      expect(isTrustedSandboxEvent(ev, fakeIframe)).toBe(true);
    });

    it('clampTimeout enforces [1000, 120000] bounds and falls back to default for non-numbers', () => {
      expect(clampTimeout(500)).toBe(1000);
      expect(clampTimeout(99999999)).toBe(120000);
      expect(clampTimeout(15_000)).toBe(15_000);
      // Non-finite / NaN / undefined → default
      expect(clampTimeout(Number.NaN)).toBe(DEFAULT_TIMEOUT_MS);
      expect(clampTimeout(undefined as unknown as number)).toBe(DEFAULT_TIMEOUT_MS);
    });

    it('forwards a user-supplied timeoutMs to runInSandbox (within clamp bounds)', async () => {
      let captured: number | undefined;
      const t = runScriptTool('p', {
        runInSandbox: async (_pid, _code, timeoutMs) => {
          captured = timeoutMs;
          return { logs: [], filesWritten: [] };
        },
      });
      await t.execute!({ code: 'noop', timeoutMs: 5_000 } as never, ctx);
      expect(captured).toBe(5_000);
    });

    it('clamps an out-of-range timeoutMs before forwarding to runInSandbox', async () => {
      let captured: number | undefined;
      const t = runScriptTool('p', {
        runInSandbox: async (_pid, _code, timeoutMs) => {
          captured = timeoutMs;
          return { logs: [], filesWritten: [] };
        },
      });
      await t.execute!({ code: 'noop', timeoutMs: 1 } as never, ctx);
      expect(captured).toBe(1_000);
      await t.execute!({ code: 'noop', timeoutMs: 9_999_999 } as never, ctx);
      expect(captured).toBe(120_000);
    });

    it('uses DEFAULT_TIMEOUT_MS when timeoutMs is omitted', async () => {
      let captured: number | undefined;
      const t = runScriptTool('p', {
        runInSandbox: async (_pid, _code, timeoutMs) => {
          captured = timeoutMs;
          return { logs: [], filesWritten: [] };
        },
      });
      await t.execute!({ code: 'noop' }, ctx);
      expect(captured).toBe(DEFAULT_TIMEOUT_MS);
    });
  });
});
