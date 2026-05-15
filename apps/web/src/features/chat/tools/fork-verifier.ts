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
//
// W1 §2.6 — `__async` placeholder protocol (Anthropic v2 alignment):
//   The execute() return value carries the v2-shape `{__async, _toolName,
//   _label, placeholder}` fields IN ADDITION TO the legacy `verifierSpawned`
//   / `instructions` / `message` fields. This means:
//     - the orchestrator (use-agent-chat.ts) keeps detecting fork via the
//       legacy `tool-fork_verifier_agent` part transition (no churn);
//     - any future dispatcher / wrapper that wants to honor the v2 protocol
//       (place the placeholder string into the LLM's context, surface the
//       label in the UI activity stream) can read the `__async` fields.
//   Placeholder text is verbatim from
//   `wonderful-mendeleev-5231a7/.../artifacts/agent-loop/verifier-tools-and-fork-boundary.raw.js`
//   so the LLM sees exactly what the official agent loop emits.

import { tool } from 'ai';
import { z } from 'zod';

const PLACEHOLDER_FULL_SWEEP =
  'Verifier subagent forked and running in the background. This is NOT the fork — you are still the main agent. The verifier will only call back if it finds issues; no news is good news. End your turn.';

const PLACEHOLDER_DIRECTED_CHECK =
  'Verifier subagent forked for a directed check. This is NOT the fork — you are still the main agent. The verifier will report back regardless of verdict. End your turn.';

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
      const trimmedInstructions = (instructions ?? '').trim();
      const directed = trimmedInstructions.length > 0;
      // Pure signal — the orchestrator (use-agent-chat) detects this output
      // and spawns the verifier with the inherited history. We don't run the
      // verifier here because tool execute is sync-ish and we want the
      // verifier to stream back through its own Chat instance.
      //
      // Both the legacy fields AND the v2 `__async` protocol fields are
      // present so downstream consumers can pick whichever is convenient.
      return {
        // ── v2 __async protocol ─────────────────────────────────────────────
        __async: true as const,
        _toolName: 'fork_verifier_agent' as const,
        _label: directed ? `Verifier: ${trimmedInstructions.slice(0, 40)}` : 'Verifier',
        placeholder: directed ? PLACEHOLDER_DIRECTED_CHECK : PLACEHOLDER_FULL_SWEEP,
        // ── legacy signal (use-agent-chat orchestrator) ─────────────────────
        verifierSpawned: true as const,
        instructions: trimmedInstructions,
        message: 'Verifier sub-agent spawned. The verdict will arrive as a separate user message.',
      };
    },
  });
}
