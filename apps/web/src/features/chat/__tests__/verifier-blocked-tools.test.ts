// W1 §2.8 — Verifier blocked tool set + wrapToolsForVerifierMode.
//
// Anthropic's bundle has a `see` Set (32 tool names) that the dispatcher
// checks before executing a tool inside a verifier fork. If the verifier
// tries to call a blocked tool, the dispatcher returns a synthetic
// is-error tool_result without actually invoking execute(). This is on top
// of the FORK_BOUNDARY_PROMPT (prompt-level guardrail) — same goal, two
// layers of defense.
//
// Our MVP tool set is smaller, so BLOCKED_TOOLS_VERIFIER is the v2 `see`
// list filtered to "tools that exist in our makeTools()". Reference v2 file:
// wonderful-mendeleev-5231a7/.../artifacts/agent-loop/verifier-tools-and-fork-boundary.raw.js

import { describe, expect, it, vi } from 'vitest';
import { BLOCKED_TOOLS_VERIFIER, isBlockedInVerifier, wrapToolsForVerifierMode } from '../verifier';

describe('BLOCKED_TOOLS_VERIFIER set', () => {
  it('is an immutable Set of strings', () => {
    expect(BLOCKED_TOOLS_VERIFIER).toBeInstanceOf(Set);
    for (const v of BLOCKED_TOOLS_VERIFIER) expect(typeof v).toBe('string');
  });

  it('blocks the mutation tools we currently ship', () => {
    // These are the v2 `see` items that have a corresponding tool in our
    // makeTools(). Filtering matters because if we listed tools we don't
    // ship, prepareStep wrap would do nothing (no key to match) — fine, but
    // confusing for readers.
    expect(BLOCKED_TOOLS_VERIFIER.has('write_file')).toBe(true);
    expect(BLOCKED_TOOLS_VERIFIER.has('str_replace_based_edit_tool')).toBe(true);
    expect(BLOCKED_TOOLS_VERIFIER.has('delete_file')).toBe(true);
    expect(BLOCKED_TOOLS_VERIFIER.has('copy_files')).toBe(true);
  });

  it('blocks the non-write mutation tools', () => {
    expect(BLOCKED_TOOLS_VERIFIER.has('update_todos')).toBe(true);
    expect(BLOCKED_TOOLS_VERIFIER.has('done')).toBe(true);
  });

  it('blocks recursive fork', () => {
    expect(BLOCKED_TOOLS_VERIFIER.has('fork_verifier_agent')).toBe(true);
  });

  it('blocks the W2-bound snip + register_assets tools (defensive even if they are not yet in makeTools)', () => {
    expect(BLOCKED_TOOLS_VERIFIER.has('snip')).toBe(true);
    expect(BLOCKED_TOOLS_VERIFIER.has('register_assets')).toBe(true);
  });

  it('does NOT block read-only tools the verifier needs', () => {
    expect(BLOCKED_TOOLS_VERIFIER.has('read_file')).toBe(false);
    expect(BLOCKED_TOOLS_VERIFIER.has('list_files')).toBe(false);
    expect(BLOCKED_TOOLS_VERIFIER.has('grep')).toBe(false);
    expect(BLOCKED_TOOLS_VERIFIER.has('view_image')).toBe(false);
    expect(BLOCKED_TOOLS_VERIFIER.has('verification_feedback')).toBe(false);
  });

  it('isBlockedInVerifier is just a Set.has wrapper', () => {
    expect(isBlockedInVerifier('write_file')).toBe(true);
    expect(isBlockedInVerifier('read_file')).toBe(false);
    expect(isBlockedInVerifier('totally_made_up_tool')).toBe(false);
  });
});

describe('wrapToolsForVerifierMode', () => {
  function makeFakeTool(_name: string, executeFn: (...args: unknown[]) => unknown) {
    return {
      description: 'fake',
      inputSchema: { safeParse: () => ({ success: true }) },
      execute: executeFn,
    };
  }

  it('returns the same tools object when mode is "main"', () => {
    const writeSpy = vi.fn(() => ({ ok: true }));
    const readSpy = vi.fn(() => 'data');
    const tools = {
      write_file: makeFakeTool('write_file', writeSpy),
      read_file: makeFakeTool('read_file', readSpy),
    };
    const wrapped = wrapToolsForVerifierMode(tools, 'main');
    // Same execute references untouched in main mode.
    expect(wrapped.write_file.execute).toBe(writeSpy);
    expect(wrapped.read_file.execute).toBe(readSpy);
  });

  it('replaces blocked tools.execute with an error-returning stub in verifier mode', async () => {
    const writeSpy = vi.fn(() => ({ ok: true }));
    const tools = { write_file: makeFakeTool('write_file', writeSpy) };
    const wrapped = wrapToolsForVerifierMode(tools, 'verifier');

    // The execute is replaced by a function that does NOT call writeSpy.
    expect(wrapped.write_file.execute).not.toBe(writeSpy);
    const result = await (wrapped.write_file.execute as () => Promise<unknown>)();
    expect(writeSpy).not.toHaveBeenCalled();
    // Result message follows v2 wording (verbatim references the
    // verification_feedback terminator + read-only tools).
    const text = JSON.stringify(result);
    expect(text).toMatch(/not available in this fork/i);
    expect(text).toMatch(/verifier subagent/i);
    expect(text).toMatch(/verification_feedback/);
  });

  it('leaves non-blocked tools untouched in verifier mode', () => {
    const readSpy = vi.fn(() => 'data');
    const tools = { read_file: makeFakeTool('read_file', readSpy) };
    const wrapped = wrapToolsForVerifierMode(tools, 'verifier');
    expect(wrapped.read_file.execute).toBe(readSpy);
  });

  it('preserves the input schema and description on wrapped tools', () => {
    const tool = makeFakeTool('write_file', () => null);
    const wrapped = wrapToolsForVerifierMode({ write_file: tool }, 'verifier');
    expect(wrapped.write_file.description).toBe('fake');
    expect(wrapped.write_file.inputSchema).toBe(tool.inputSchema);
  });

  it('returns isError: true on the wrapped result so AI SDK marks it as an error tool_result', async () => {
    const tool = makeFakeTool('write_file', () => null);
    const wrapped = wrapToolsForVerifierMode({ write_file: tool }, 'verifier');
    const result = (await (wrapped.write_file.execute as () => Promise<unknown>)()) as {
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
  });
});
