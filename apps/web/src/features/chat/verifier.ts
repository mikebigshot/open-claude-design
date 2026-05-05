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
import { createAgent, type CreateAgentOptions } from './agent.js';
import { FORK_BOUNDARY_PROMPT } from './verifier-prompt.js';
import type { DesignAgentUIMessage } from './ui-messages.js';

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
