// verification_feedback — verifier exit-point tool.

import { describe, expect, it } from 'vitest';
import { verificationFeedbackTool } from '../verification-feedback';

interface ToolWithExecute {
  description: string;
  inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
  execute?: (input: { verdict: 'done' | 'needs_work'; description?: string }) => Promise<string>;
}

describe('verificationFeedbackTool', () => {
  it('description marks the tool as VERIFIER ONLY', () => {
    const t = verificationFeedbackTool() as unknown as ToolWithExecute;
    expect(t.description).toMatch(/VERIFIER/);
  });

  it('accepts a `done` verdict', () => {
    const t = verificationFeedbackTool() as unknown as ToolWithExecute;
    expect(t.inputSchema?.safeParse({ verdict: 'done', description: 'all good' }).success).toBe(
      true,
    );
  });

  it('accepts a `needs_work` verdict', () => {
    const t = verificationFeedbackTool() as unknown as ToolWithExecute;
    expect(
      t.inputSchema?.safeParse({ verdict: 'needs_work', description: 'broken JSX' }).success,
    ).toBe(true);
  });

  it('rejects an unknown verdict value', () => {
    const t = verificationFeedbackTool() as unknown as ToolWithExecute;
    expect(t.inputSchema?.safeParse({ verdict: 'maybe', description: 'x' }).success).toBe(false);
  });

  it('allows missing description when verdict is `done` (nothing to report)', () => {
    const t = verificationFeedbackTool() as unknown as ToolWithExecute;
    expect(t.inputSchema?.safeParse({ verdict: 'done' }).success).toBe(true);
  });

  it('rejects missing description when verdict is `needs_work` (zod refine)', () => {
    const t = verificationFeedbackTool() as unknown as ToolWithExecute;
    expect(t.inputSchema?.safeParse({ verdict: 'needs_work' }).success).toBe(false);
  });

  it('execute returns the official no-op terminator string (verdict is read from tool_call.input)', async () => {
    const t = verificationFeedbackTool() as unknown as ToolWithExecute;
    const result = await t.execute!({
      verdict: 'needs_work',
      description: 'broken',
    });
    expect(typeof result).toBe('string');
    expect(result).toMatch(/no-?op/i);
    expect(result).toMatch(/verifier/i);
  });
});
