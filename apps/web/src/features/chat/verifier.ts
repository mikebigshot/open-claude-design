// spawnVerifier — orchestrates a verifier sub-agent using a fresh Chat
// instance whose id is `<main session id>::verifier`. The `::verifier`
// suffix is part of the wire protocol — don't rename without coordinating.
//
// Architectural notes:
//
// 1. **Vercel AI SDK fork mechanism** — the verifier inherits the main
//    agent's full
//    transcript, then we kick off its first turn with `sendMessage({text:
//    FORK_BOUNDARY_PROMPT})`. Functionally equivalent — the model sees a
//    user-role message containing the role-reset instructions.
//
// 2. **Termination via stopWhen** — the verifier `ToolLoopAgent` is created
//    with `mode: 'verifier'`, which sets `stopWhen: hasToolCall(
//    'verification_feedback')`. The agent loop exits the moment that tool
//    fires, so `chat.status` transitions back to 'ready'. We watch for
//    that via the Chat `onFinish` callback.
//
// 3. **Hard timeout** — wraps the whole loop in a Promise.race with a 60s
//    timeout. Verifier scope is bounded; if it's still running after a
//    minute something's wrong (model rambling, network stall) and the
//    orchestrator should surface that to the user.
//
// 4. **No mutating side effects expected** — verifier should not write
//    files. Per FORK_BOUNDARY_PROMPT it's "blocked" (prompt-level only);
//    if a misbehaving verifier does write, the change lands in R2 and is
//    visible to the main agent. The orchestrator does not undo it.

import { Chat } from '@ai-sdk/react';
import { DirectChatTransport, type UIMessage } from 'ai';
import { createAgent, type AgentMode, type CreateAgentOptions } from './agent.js';
import { FORK_BOUNDARY_PROMPT } from './verifier-prompt.js';
import type { DesignAgentUIMessage } from './ui-messages.js';

// ── §2.8 verifier blocked tool set ────────────────────────────────────────
//
// Source: v2 `wonderful-mendeleev-5231a7/.../artifacts/agent-loop/
//          verifier-tools-and-fork-boundary.raw.js` — the `see` Set.
//
// We intersect the v2 list with "tools we ship in our makeTools()" and add
// the W2-bound tools (`snip`, `register_assets`, `questions_v2` etc.) so
// when those are wired in later they're blocked from day one.
//
// Note name mapping: v2 calls the str-replace tool `str_replace_edit`; we
// call ours `str_replace_based_edit_tool` (matching @anthropic-ai/sdk's
// canonical name). Use OUR name in this set since the wrapper matches
// against tool keys in `makeTools()`'s output.
export const BLOCKED_TOOLS_VERIFIER: ReadonlySet<string> = new Set<string>([
  // Mutations / writes
  'write_file',
  'str_replace_based_edit_tool',
  'delete_file',
  'copy_files',
  // Project state mutations
  'update_todos',
  'done',
  // Recursive fork prevention (verifier must not spawn another verifier)
  'fork_verifier_agent',
  // W2-bound tools — defensive: if any of them lands in makeTools later, the
  // wrapper already knows to block them inside a verifier fork.
  'snip',
  'register_assets',
  'unregister_assets',
  'questions_v2',
  'show_to_user',
  'save_screenshot',
  'set_project_title',
  'save_as_template',
  'run_script',
]);

/** Convenience predicate over BLOCKED_TOOLS_VERIFIER — for readability. */
export function isBlockedInVerifier(toolName: string): boolean {
  return BLOCKED_TOOLS_VERIFIER.has(toolName);
}

/**
 * Loose tool shape (matches what `makeTools()` returns / what AI SDK 6's
 * `tool()` helper produces). Only the bits we care about — `description`,
 * `inputSchema`, `execute` — are referenced. Extra fields (parameters,
 * providerOptions, etc.) flow through untouched.
 *
 * Using `any` here intentionally: the actual AI SDK Tool type has phantom
 * generics we don't need to re-prove. The wrapper preserves the shape, and
 * the wrapped tools are immediately handed to ToolLoopAgent which re-types
 * them at the consumption boundary.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyToolish = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * v2 verbatim error message (with our terminator name). Modeled on the
 * verifier-loop's `te.push({...is_error:true, content: \`Tool "${P.name}"
 * is not available in this fork...\`})` branch.
 */
function blockedExecuteMessage(toolName: string): string {
  return `Tool "${toolName}" is not available in this fork. You are the verifier subagent — use show_html/screenshot/get_webview_logs/eval_js to verify, then call verification_feedback with your verdict.`;
}

/**
 * Wrap a `makeTools()` result so blocked tools' execute() short-circuits to
 * an is-error tool_result instead of running the real implementation. In
 * `'main'` mode the wrap is a pass-through (same execute references).
 *
 * Defense-in-depth: the FORK_BOUNDARY_PROMPT already tells the verifier not
 * to call mutation tools, but the prompt is a soft guardrail; this hard
 * guardrail makes a misbehaving verifier unable to actually mutate state.
 */
export function wrapToolsForVerifierMode<T extends Record<string, AnyToolish>>(
  tools: T,
  mode: AgentMode,
): T {
  if (mode === 'main') return tools;
  const wrapped: Record<string, AnyToolish> = {};
  for (const key of Object.keys(tools)) {
    const original = tools[key] as AnyToolish;
    if (!isBlockedInVerifier(key)) {
      wrapped[key] = original;
      continue;
    }
    wrapped[key] = {
      ...original,
      execute: async () => ({
        isError: true,
        content: blockedExecuteMessage(key),
      }),
    } as AnyToolish;
  }
  return wrapped as T;
}

export interface SpawnVerifierOptions extends Omit<CreateAgentOptions, 'mode' | 'onTodosUpdate'> {
  /** The main agent's session id (used to derive `::verifier` suffix). */
  mainSessionId: string;
  /** Full main-agent message history at fork time (will be inherited verbatim). */
  mainMessages: DesignAgentUIMessage[];
  /** Optional hints from the main agent's `fork_verifier_agent` tool input. */
  instructions?: string;
  /**
   * Hard timeout in ms. Defaults to 60_000. After this, the orchestrator
   * resolves with `{verdict: 'needs_work', description: 'Verifier timed out'}`
   * — never throws, since the main agent flow should always continue.
   */
  timeoutMs?: number;
}

export interface VerifierResult {
  verdict: 'done' | 'needs_work';
  description: string;
  /** Full verifier transcript at termination (for UI inspection / debugging). */
  messages: DesignAgentUIMessage[];
  /** True if the verifier ran out of time and the orchestrator forced a verdict. */
  timedOut: boolean;
}

/**
 * Spawn the verifier sub-agent and return its verdict.
 *
 * The verifier's `onTodosUpdate` is a no-op — the verifier should not be
 * touching project todos (it's a read-only inspector).
 */
export async function spawnVerifier(opts: SpawnVerifierOptions): Promise<VerifierResult> {
  const verifierId = `${opts.mainSessionId}::verifier`;
  const agent = createAgent({
    ...opts,
    mode: 'verifier',
    onTodosUpdate: () => {
      /* no-op — verifier doesn't manage todos */
    },
  });

  return new Promise<VerifierResult>((resolve) => {
    let resolved = false;
    const safelyResolve = (result: VerifierResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const verifier = new Chat<DesignAgentUIMessage>({
      id: verifierId,
      transport: new DirectChatTransport({ agent }),
      messages: opts.mainMessages,
      onFinish: ({ messages }) => {
        const result = extractVerdict(messages);
        if (result) safelyResolve({ ...result, timedOut: false });
      },
      onError: (err) => {
        // Surface error as a synthetic needs_work verdict so the main agent's
        // flow doesn't get stuck. The error message gets surfaced to the user.
        safelyResolve({
          verdict: 'needs_work',
          description: `Verifier errored: ${err instanceof Error ? err.message : String(err)}`,
          messages: verifier.messages,
          timedOut: false,
        });
      },
    });

    const text = opts.instructions
      ? `${FORK_BOUNDARY_PROMPT}\n\nMain agent's hints: ${opts.instructions}`
      : FORK_BOUNDARY_PROMPT;
    void verifier.sendMessage({ text });

    const timeoutMs = opts.timeoutMs ?? 60_000;
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (!resolved) {
          safelyResolve({
            verdict: 'needs_work',
            description: `Verifier did not return a verdict within ${timeoutMs}ms — main agent should re-check the most recent files manually.`,
            messages: verifier.messages,
            timedOut: true,
          });
        }
      }, timeoutMs);
    }
  });
}

/**
 * Locate the most recent `tool-verification_feedback` part with state
 * `output-available` in the verifier's transcript. Returns null if no
 * verdict has been issued yet.
 */
export function extractVerdict(messages: DesignAgentUIMessage[]): {
  verdict: 'done' | 'needs_work';
  description: string;
  messages: DesignAgentUIMessage[];
} | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    for (const part of msg.parts) {
      const p = part as {
        type?: string;
        state?: string;
        input?: { verdict?: string; description?: string };
      };
      if (
        p.type === 'tool-verification_feedback' &&
        p.state === 'output-available' &&
        p.input?.verdict &&
        (p.input.verdict === 'done' || p.input.verdict === 'needs_work')
      ) {
        return {
          verdict: p.input.verdict,
          description: p.input.description ?? '',
          messages,
        };
      }
    }
  }
  return null;
}

/** Format the verdict as a user-facing message body to inject back into main. */
export function formatVerdictForMain(result: VerifierResult): string {
  const head =
    result.verdict === 'done'
      ? '✅ Verifier verdict: **done**'
      : '⚠️ Verifier verdict: **needs_work**';
  const desc = result.description.trim() || '(no description)';
  const tail = result.timedOut ? '\n\n_(Verifier ran out of time — verdict synthesized.)_' : '';
  return `A background task has completed. Here are the results:\n\n${head}\n\n${desc}${tail}`;
}

// Re-export for tests / type users.
export type { UIMessage };
