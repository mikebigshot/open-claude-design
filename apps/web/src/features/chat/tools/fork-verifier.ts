// fork_verifier_agent — main agent calls this after a coherent unit of work
// to spawn a verifier sub-agent that QAs the output. The execute fn here is a
// pure signal: it returns a marker indicating "verifier should be spawned".
// The actual fork happens in `verifier.ts`'s `spawnVerifier()`, which the
// `useAgentChat` hook invokes when it sees a `tool-fork_verifier_agent` part
// transition to `output-available`.
//
// Source-of-truth contract:
//   - Tool name MUST be `fork_verifier_agent` (protocol literal).
//   - Verifier session id = `<main session uuid>::verifier`.
//   - Verifier inherits the main agent's full message history.
//   - Verifier exits via `verification_feedback` (the only valid exit).
//
// Per §"协议字面量" of CLAUDE.md, the literal `fork_verifier_agent` name +
// the `::verifier` suffix are protocol bits — do not rename.

import { tool } from 'ai';
import { z } from 'zod';

export function forkVerifierTool() {
  return tool({
    description: [
      'Spawn a verifier sub-agent to QA the work you just did. Use this AFTER',
      'completing a substantive coherent unit (a screen, a feature, an edit',
      'iteration) and BEFORE calling `done`. The verifier inherits your full',
      'context, reads the files you wrote, checks for syntax / logic / missing',
      'pieces, and returns a verdict (`done` or `needs_work`). If the verdict',
      'is `needs_work`, address the feedback before marking done.',
      '',
      'Optional `instructions` lets you hint at what to look for (e.g. "double',
      'check the new dropdown handles outside-click").',
    ].join(' '),
    inputSchema: z.object({
      instructions: z
        .string()
        .optional()
        .describe('Optional hints for the verifier — what aspects of the recent work to focus on.'),
    }),
    execute: async ({ instructions }) => {
      // Pure signal — the orchestrator (use-agent-chat) detects this output
      // and spawns the verifier with the inherited history. We don't run the
      // verifier here because tool execute is sync-ish and we want the
      // verifier to stream back through its own Chat instance.
      return {
        verifierSpawned: true as const,
        instructions: instructions ?? '',
        message: 'Verifier sub-agent spawned. The verdict will arrive as a separate user message.',
      };
    },
  });
}
