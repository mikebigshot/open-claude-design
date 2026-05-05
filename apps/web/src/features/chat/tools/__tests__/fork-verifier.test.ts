// fork_verifier_agent — input schema + execute signal payload.

import { describe, expect, it } from 'vitest';
import { forkVerifierTool } from '../fork-verifier';

interface ToolWithExecute {
  description: string;
  inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
  execute?: (
    input: { instructions?: string },
    opts?: { abortSignal?: AbortSignal },
  ) => Promise<{ verifierSpawned: true; instructions: string; message: string }>;
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

  it('execute returns the verifierSpawned signal payload', async () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    const result = await t.execute!({ instructions: 'check dropdown' });
    expect(result).toEqual({
      verifierSpawned: true,
      instructions: 'check dropdown',
      message: expect.stringMatching(/verdict will arrive/i),
    });
  });

  it('execute defaults instructions to empty string when omitted', async () => {
    const t = forkVerifierTool() as unknown as ToolWithExecute;
    const result = await t.execute!({});
    expect(result.instructions).toBe('');
  });
});
