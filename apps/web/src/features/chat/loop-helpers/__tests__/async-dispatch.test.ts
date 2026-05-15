// `__async` protocol — agent.ts wrapper detects this object shape from a
// tool's execute() and treats the result specially (placeholder string fed to
// LLM, real work scheduled in background). v2 reference is in
// `wonderful-mendeleev-5231a7/.../artifacts/agent-loop/main-agent-loop-full.raw.js`
// (the dispatcher Ae closure).

import { describe, expect, it } from 'vitest';
import { ASYNC_PROTOCOL_KEY, extractAsyncSpec, isAsyncToolResult } from '../async-dispatch';

describe('__async protocol detector', () => {
  it('exports the protocol key as "__async"', () => {
    expect(ASYNC_PROTOCOL_KEY).toBe('__async');
  });

  it('isAsyncToolResult returns false for primitives', () => {
    expect(isAsyncToolResult(null)).toBe(false);
    expect(isAsyncToolResult(undefined)).toBe(false);
    expect(isAsyncToolResult('async')).toBe(false);
    expect(isAsyncToolResult(42)).toBe(false);
    expect(isAsyncToolResult(true)).toBe(false);
  });

  it('isAsyncToolResult returns false for plain objects without __async', () => {
    expect(isAsyncToolResult({})).toBe(false);
    expect(isAsyncToolResult({ verifierSpawned: true })).toBe(false);
    expect(isAsyncToolResult({ __async: false, _toolName: 'x' })).toBe(false);
  });

  it('isAsyncToolResult requires both __async true AND _toolName string', () => {
    expect(isAsyncToolResult({ __async: true })).toBe(false);
    expect(isAsyncToolResult({ __async: true, _toolName: 42 })).toBe(false);
    expect(
      isAsyncToolResult({
        __async: true,
        _toolName: 'fork_verifier_agent',
      }),
    ).toBe(true);
  });

  it('extractAsyncSpec returns the typed spec when valid', () => {
    const spec = {
      __async: true as const,
      _toolName: 'fork_verifier_agent',
      _label: 'Verifier',
      placeholder: 'Verifier subagent forked.',
    };
    expect(extractAsyncSpec(spec)).toBe(spec);
  });

  it('extractAsyncSpec returns null when invalid', () => {
    expect(extractAsyncSpec(null)).toBeNull();
    expect(extractAsyncSpec({})).toBeNull();
    expect(extractAsyncSpec({ verifierSpawned: true })).toBeNull();
  });
});
