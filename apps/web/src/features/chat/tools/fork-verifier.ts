// fork_verifier_agent — spawn a verifier sub-agent INLINE from the tool
// execute(). Mirrors the official Claude Design implementation (research v2
// §10.5 + §14.2):
//
//   - `execute()` does the real spawn — there is NO effect watching message
//     history. This means reload / hydration cannot re-spawn a verifier:
//     `execute()` only runs when the main agent loop is currently in a turn
//     and the LLM emits a `fork_verifier_agent` tool_use block.
//
//   - Two guards exactly mirror the official `Tb` map + `tee()` check:
//       Guard #1 (snapshot presence): if no main loop is registered for the
//         active chatId, return an `isError` tool_result. This kills the
//         "page reload spawns verifier from history" anti-pattern at the
//         root — `getMainLoopSnapshot()` is null whenever the main loop is
//         not currently mid-turn.
//       Guard #2 (single-verifier-per-chat): if a verifier is already
//         running for `<chatId>::verifier`, reject with an `isError`. The
//         viewport lock releases when spawnVerifier resolves / rejects /
//         times out.
//
//   - Returns immediately with the v2 `__async` placeholder shape. The
//     verifier streams in the background; its verdict is fed back as a
//     fresh user message via the snapshot's `onVerdict` callback (which the
//     `useAgentChat` registration wires to `chat.sendMessage`).
//
// Source-of-truth contract (per CLAUDE.md §"协议字面量"):
//   - Tool name MUST be `fork_verifier_agent`.
//   - Verifier session id = `<main session uuid>::verifier`.
//   - Verifier inherits the main agent's full message history.
//   - Verifier exits via `verification_feedback` only.
//   - Input field name is `task` (matches official; old chats persisted with
//     `instructions:` are just historical records — they don't get re-fired).
//
// Placeholder text is verbatim from
//   `internal/docs/research/claude-design-v2/artifacts/agent-loop/
//    verifier-tools-and-fork-boundary.raw.js`
// so the LLM sees exactly what the official agent loop emits.

import { tool } from 'ai';
import { z } from 'zod';
import { hasDoneFired } from '../lib/done-gate.js';
import {
  getMainLoopSnapshot,
  tryAcquireVerifier,
  releaseVerifier,
} from '../main-loop-registry.js';
import { spawnVerifier } from '../verifier.js';

const PLACEHOLDER_FULL_SWEEP =
  'Verifier subagent forked and running in the background. This is NOT the fork — you are still the main agent. The verifier will only call back if it finds issues; no news is good news. End your turn.';

const PLACEHOLDER_DIRECTED_CHECK =
  'Verifier subagent forked for a directed check. This is NOT the fork — you are still the main agent. The verifier will report back regardless of verdict. End your turn.';

const ERR_NO_SNAPSHOT =
  'Error: verifier snapshot unavailable (agent loop did not register the hook). The main agent loop must be in a turn for `fork_verifier_agent` to spawn — this tool cannot be called during chat hydration or from a stale render.';

const ERR_ALREADY_RUNNING =
  'Error: a verifier subagent is already running for this chat. Wait for its verdict before forking again.';

const ERR_NO_CHAT_ID =
  'Error: no active chat id at the time of fork. This usually means the workspace is still hydrating; retry once the chat is loaded.';

const ERR_DONE_REQUIRED =
  'Error: call `done` first to surface a working view to the user before forking the verifier. (Or pass `task` for a directed mid-task check that bypasses this gate.)';

export interface ForkVerifierToolDeps {
  /** Lazy getter so the active chatId is read at execute time, not at agent-build time. */
  getChatId: () => string | null;
}

export function forkVerifierTool(deps: ForkVerifierToolDeps) {
  return tool({
    description: [
      'Fork a verifier subagent to check your output. The verifier inherits',
      'your full transcript, reads the files you wrote, takes screenshots,',
      'checks console logs, and reports back. Runs in the background — you',
      'get the verdict later as a new user message. Two modes:',
      '',
      '(1) **Full sweep** — call with no args AFTER `done` reports clean.',
      'Silent on pass, only wakes you if something is wrong.',
      '',
      '(2) **Directed check** — pass `task` (e.g. "screenshot and check the',
      'spacing") for a mid-task probe; ALWAYS reports back regardless of',
      'verdict, no `done` required first.',
    ].join(' '),
    inputSchema: z.object({
      task: z
        .string()
        .optional()
        .describe(
          'Optional: a specific thing to check (e.g. "screenshot and check spacing", "eval_js to verify the slider works"). When set, the verifier focuses on this and ALWAYS reports back, even on pass. When omitted, the verifier does a full sweep and stays silent on pass.',
        ),
    }),
    execute: async ({ task }) => {
      // Guard #0 — must have an active chat to derive the viewport key.
      const chatId = deps.getChatId();
      if (!chatId) {
        return { isError: true, content: ERR_NO_CHAT_ID };
      }

      // Guard #1 — main loop snapshot must exist (mirror of official `Tb.get(chatId)`).
      // This is the load-bearing guard: reload / hydration / stale render
      // all hit this branch because no main loop registers itself outside a
      // streaming turn.
      const snapshot = getMainLoopSnapshot(chatId);
      if (!snapshot) {
        return { isError: true, content: ERR_NO_SNAPSHOT };
      }

      const trimmedTask = (task ?? '').trim();
      const directed = trimmedTask.length > 0;

      // Guard #2 — done-gate (mirror of official `l6(chatId)`). Full-sweep
      // mode (no task) requires that `done` ran cleanly first; directed
      // checks (task present) bypass the gate per official semantics.
      if (!directed && !hasDoneFired(chatId)) {
        return { isError: true, content: ERR_DONE_REQUIRED };
      }

      // Guard #3 — single verifier per chat viewport (mirror of `tee(s)`).
      const viewportKey = `${chatId}::verifier`;
      if (!tryAcquireVerifier(viewportKey)) {
        return { isError: true, content: ERR_ALREADY_RUNNING };
      }

      // Flip UI state to "verifier running" before kicking off the spawn so
      // the panel can show a spinner / activity item right away.
      snapshot.onSpawnStart();

      // Fire-and-forget: the LLM sees the placeholder immediately and ends
      // its turn (per v2 §10.5 the placeholder text instructs the model NOT
      // to wait). The verdict re-enters the main thread as a fresh user
      // message via snapshot.onVerdict (wired to chat.sendMessage by
      // useAgentChat).
      void spawnVerifier({
        projectId: snapshot.projectId,
        apiKey: snapshot.apiKey,
        provider: snapshot.provider,
        fidelity: snapshot.fidelity,
        designSystemId: snapshot.designSystemId,
        designSystemName: snapshot.designSystemName,
        designSystemTokensCss: snapshot.designSystemTokensCss,
        mainSessionId: snapshot.mainSessionId,
        mainMessages: snapshot.messages,
        instructions: trimmedTask || undefined,
      })
        .then(
          (result) => {
            try {
              snapshot.onVerdict(result);
            } catch (err) {
              console.error('[fork_verifier_agent] onVerdict callback threw', err);
            }
          },
          (err: unknown) => {
            const wrapped = err instanceof Error ? err : new Error(String(err));
            try {
              snapshot.onError(wrapped);
            } catch (cbErr) {
              console.error('[fork_verifier_agent] onError callback threw', cbErr);
            }
          },
        )
        .finally(() => {
          releaseVerifier(viewportKey);
        });

      return {
        __async: true as const,
        _toolName: 'fork_verifier_agent' as const,
        _label: directed ? `Verifier: ${trimmedTask.slice(0, 40)}` : 'Verifier',
        placeholder: directed ? PLACEHOLDER_DIRECTED_CHECK : PLACEHOLDER_FULL_SWEEP,
      };
    },
  });
}
