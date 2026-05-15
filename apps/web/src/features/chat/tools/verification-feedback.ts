// verification_feedback — the verifier's ONLY exit point.
//
// Key behaviors:
//   1. `description` is required only when `verdict === 'needs_work'`. A
//      `done` verdict needs no rationale (nothing's broken). Enforced via
//      zod `.refine()`.
//   2. `execute()` returns the literal no-op string. The orchestrator reads
//      the verdict from the tool_call.input (see verifier.ts), not from
//      this return value — so the body just signals "verifier loop done".
//
// The FORK BOUNDARY prompt instructs the verifier: "Your verdict MUST go in
// the verification_feedback tool call — that is the ONLY exit." This tool's
// existence combined with the verifier's
// `stopWhen: hasToolCall('verification_feedback')` is what terminates the
// verifier loop.

import { tool } from 'ai';
import { z } from 'zod';

const TERMINATOR_RESULT =
  '(no-op — verification_feedback only terminates inside the verifier fork)';

export function verificationFeedbackTool() {
  return tool({
    description: [
      'VERIFIER ONLY — the only valid way to exit the verifier loop. Submit a',
      'verdict (`done` or `needs_work`). `done` if the output looks correct',
      '(layout, no console errors, content renders as intended). `needs_work`',
      'ONLY if there are real, actionable problems — not nitpicks. Required',
      '`description` when verdict is needs_work: specific, actionable details',
      'so the main agent can act on it. Omit description when verdict is done.',
    ].join(' '),
    inputSchema: z
      .object({
        verdict: z
          .enum(['done', 'needs_work'])
          .describe("`done` = main agent's output is acceptable. `needs_work` = real bug found."),
        description: z
          .string()
          .optional()
          .describe(
            'Required when verdict is needs_work. Specific, actionable description of what is broken and how you know (console error, visual defect in screenshot, etc). Omit when verdict is done.',
          ),
      })
      .refine(
        (v) => v.verdict !== 'needs_work' || (typeof v.description === 'string' && v.description.length > 0),
        {
          message: '`description` is required when verdict is "needs_work".',
          path: ['description'],
        },
      ),
    execute: async () => TERMINATOR_RESULT,
  });
}
