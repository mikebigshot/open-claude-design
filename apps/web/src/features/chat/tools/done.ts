import { tool } from 'ai';
import { z } from 'zod';

// The string the LLM sees as tool_result content after calling `done`. The
// final "Next: ..." sentence is verbatim from Anthropic's official
// claude.ai/design bundle (research/claude-design-v2/artifacts/tool-
// implementations/done.js). That nudge is the single biggest reason
// Sonnet/Opus reliably forks the verifier after `done`; without it smaller
// models (Haiku 4.5 — observed in e2e) skip the fork entirely. We mirror
// the wording verbatim so model behavior matches official.
const FORK_VERIFIER_NUDGE =
  'Next: call fork_verifier_agent (or end your turn if this was a trivial tweak).';

export function doneTool() {
  return tool({
    description:
      "Surface the file to the user. Call this when you've finished a coherent unit of work (a screen, a page, an iteration). Pass a one-line `summary` describing what's been built. After done reports back, call fork_verifier_agent to spawn a background verification subagent (or end your turn if the change was trivial).",
    inputSchema: z.object({
      summary: z.string().optional().describe('One-line summary of what was built.'),
    }),
    execute: async ({ summary }) => {
      const trimmed = (summary ?? '').trim();
      if (trimmed) {
        return `Done — surfaced to the user.\n\nSummary: ${trimmed}\n\n${FORK_VERIFIER_NUDGE}`;
      }
      return `Done — surfaced to the user.\n\n${FORK_VERIFIER_NUDGE}`;
    },
  });
}
