// fork_verifier_agent — input schema + execute signal payload.
//
// W1 §2.6 layered the v2 `__async` placeholder protocol on top of the existing
// `verifierSpawned: true` signal that the use-agent-chat orchestrator looks
// for. The execute() return value now carries BOTH:
//   - the legacy `verifierSpawned` / `instructions` / `message` fields, so the
//     existing useEffect that watches for `tool-fork_verifier_agent` going to
//     `output-available` keeps working;
//   - the v2 `__async` / `_toolName` / `_label` / `placeholder` fields so the
//     dispatcher / wrapper can detect this is an async-dispatched tool. The
//     placeholder string is verbatim from `wonderful-mendeleev-5231a7/.../
//     artifacts/agent-loop/verifier-tools-and-fork-boundary.raw.js`.

import { describe, expect, it } from 'vitest';
import { forkVerifierTool } from '../fork-verifier';
import { isAsyncToolResult } from '../../loop-helpers/async-dispatch';

interface ForkResult {
  __async: true;
  _toolName: string;
  _label: string;
  placeholder: string;
  verifierSpawned: true;
  instructions: string;
  message: string;
}

interface ToolWithExecute {
  description: string;
  inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
  execute?: (
    input: { instructions?: string },
    opts?: { abortSignal?: AbortSignal },
  ) => Promise<ForkResult>;
}

describe('forkVerifierTool', () => {
  it('exposes a non-empty description mentioning fork_verifier semantics', () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    expect(t.description).toBeTruthy();
    expect(t.description.toLowerCase()).toMatch(/verifier|verify/);
  });

  it('accepts an empty input', () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    expect(t.inputSchema?.safeParse({}).success).toBe(true);
  });

  it('accepts an `instructions` string', () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    expect(t.inputSchema?.safeParse({ instructions: 'check the dropdown' }).success).toBe(true);
  });

  it('rejects non-string instructions', () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    expect(t.inputSchema?.safeParse({ instructions: 42 }).success).toBe(false);
  });

  it('execute returns the verifierSpawned signal payload (legacy)', async () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    const result = await t.execute!({ instructions: 'check dropdown' });
    expect(result.verifierSpawned).toBe(true);
    expect(result.instructions).toBe('check dropdown');
    expect(result.message).toMatch(/verdict will arrive/i);
  });

  it('execute defaults instructions to empty string when omitted', async () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    const result = await t.execute!({});
    expect(result.instructions).toBe('');
  });

  it('execute returns an __async-tagged spec with _toolName/_label/placeholder (v2 protocol)', async () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    const result = await t.execute!({});
    expect(isAsyncToolResult(result)).toBe(true);
    expect(result.__async).toBe(true);
    expect(result._toolName).toBe('fork_verifier_agent');
    expect(result._label).toMatch(/verifier/i);
    expect(typeof result.placeholder).toBe('string');
  });

  it('placeholder text is the v2 verbatim "no news is good news" string', async () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    const result = await t.execute!({});
    // Verbatim from `verifier-tools-and-fork-boundary.raw.js`:
    expect(result.placeholder).toContain('Verifier subagent forked');
    expect(result.placeholder).toContain('running in the background');
    expect(result.placeholder).toContain('NOT the fork');
    expect(result.placeholder).toContain('still the main agent');
    expect(result.placeholder).toContain('End your turn');
  });

  it('placeholder narrative shifts when instructions are provided (directed-check mode)', async () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    const result = await t.execute!({ instructions: 'check spacing' });
    // Directed checks ALWAYS report back regardless of pass/fail (v2 wording).
    expect(result.placeholder).toMatch(/directed|always report|regardless/i);
  });
});
