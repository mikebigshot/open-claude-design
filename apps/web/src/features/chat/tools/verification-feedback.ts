// verification_feedback — the verifier's ONLY exit point.
//
// The FORK BOUNDARY prompt instructs the verifier: "Your verdict MUST go in
// the verification_feedback tool call — that is the ONLY exit. A text-only
// response is a dead end." This tool's existence — combined with the
// verifier's `stopWhen: hasToolCall('verification_feedback')` — is what
// terminates the verifier loop. The execute return is read by the
// orchestrator and forwarded back to the main agent as the verdict payload.

import { tool } from 'ai';
import { z } from 'zod';

export function verificationFeedbackTool() {
  return tool({
    description: [
      'VERIFIER ONLY — the only valid way to exit the verifier loop. Submit a',
      'verdict (`done` or `needs_work`) plus a description of what you',
      'inspected and the rationale. `needs_work` should be reserved for REAL',
      'problems (broken JSX, undefined identifiers, missing files, obvious',
      'logic bugs). Nitpicks should be `done`.',
    ].join(' '),
    inputSchema: z.object({
      verdict: z
        .enum(['done', 'needs_work'])
        .describe("`done` = main agent's output is acceptable. `needs_work` = real bug found."),
      description: z
        .string()
        .describe(
          'What you checked, what was good, what (if anything) needs work. Include file paths and specifics so the main agent can act on it.',
        ),
    }),
    execute: async ({ verdict, description }) => {
      // The verifier loop terminates when this tool is called (the
      // orchestrator wires `stopWhen: hasToolCall('verification_feedback')`).
      // The output here is read by `spawnVerifier()` and surfaced back to
      // the main agent.
      return { verdict, description };
    },
  });
}
