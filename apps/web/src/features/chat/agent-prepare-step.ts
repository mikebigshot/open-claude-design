// agent-prepare-step — §2.1 + §4.2 prepareStep callback factory for
// ToolLoopAgent.
//
// At each step, AI SDK 6's `prepareStep` lets us inspect the messages that
// would be sent to the LLM and optionally override them. We use this for
// two v2-aligned behaviors:
//
//   §2.1 auto-snip when token estimate crosses threshold:
//     1. Estimate tokens of the would-be-sent messages.
//     2. If under `threshold`, return undefined (no override).
//     3. Otherwise call `getRegisteredSnips()` to fetch any snip
//        ranges queued up by the model's earlier `snip` tool calls (W2).
//     4. Apply them via `applyPendingSnips`.
//
//   §4.2 inject `<system-reminder>` when over threshold:
//     - Builds the v2 nudge text from `buildSystemReminder` (empty when
//       under threshold; non-empty when over).
//     - Prepends it to the most recent user message's text content so
//       the LLM sees the pressure hint right before its next turn.
//
// Caller wires this into `new ToolLoopAgent({prepareStep: makePrepareStep(...)})`
// inside agent.ts.

import type { RegisteredSnip } from './loop-helpers/snip-applier.js';
import { applyPendingSnips } from './loop-helpers/snip-applier.js';
import { estimateTokens, type TokenEstimatorMessage } from './loop-helpers/token-estimator.js';
import { renderTodoReminder } from './lib/render-todos.js';
import { buildSystemReminder } from './system-prompt/index.js';
import type { Todo } from './todos-state.js';

export interface MakePrepareStepOptions {
  /**
   * Function returning the snip ranges currently registered (typically
   * scoped to a single chat). Called only when the token estimate trips
   * the threshold, so cheap to leave undefined when no snip provider is
   * wired yet.
   */
  getRegisteredSnips?: () => readonly RegisteredSnip[];
  /**
   * Token threshold above which prepareStep applies pending snips and
   * injects the system-reminder. Caller typically passes
   * `model.maxTokens * 0.8` (v2 uses 0.7–0.8, leaving 20–30% buffer for
   * completion).
   */
  threshold: number;
  /**
   * Hard upper bound for context (i.e. model.maxTokens). Used to compute
   * the percentage in the v2 `<system-reminder>` nudge text. Defaults to
   * `threshold / 0.7` so the reminder text shows ≥70% utilization (v2's
   * trigger zone). Optional — caller may pass exact maxTokens for accuracy.
   */
  maxTokens?: number;
  /**
   * Function returning the current todo list for this chat. When the list
   * contains outstanding (pending) todos, the prepareStep callback injects a
   * `<todo_reminder>` block into the most recent user message. This fires
   * regardless of token threshold; it's the "did you forget about the open
   * todos" nudge.
   */
  getCurrentTodos?: () => readonly Todo[];
}

interface PrepareStepArgs {
  messages: ReadonlyArray<TokenEstimatorMessage>;
  stepNumber: number;
}

interface PrepareStepReturn {
  messages?: TokenEstimatorMessage[];
}

/**
 * Build a prepareStep callback. The returned function matches AI SDK 6's
 * `PrepareStepFunction<TOOLS>` shape (we keep types loose so it's easy to
 * stub in tests without dragging in the SDK's PrepareStepResult chain).
 */
export function makePrepareStep(opts: MakePrepareStepOptions) {
  const maxTokens = opts.maxTokens ?? opts.threshold / 0.7;
  return async (args: PrepareStepArgs): Promise<PrepareStepReturn | undefined> => {
    const { messages } = args;
    const total = estimateTokens(messages);
    const overThreshold = total >= opts.threshold;

    // Always check todos so the <todo_reminder> fires independent of
    // threshold (mirrors official pq()).
    const todos = opts.getCurrentTodos?.() ?? [];
    const todoReminder = renderTodoReminder([...todos]);

    // Fast-path: under threshold AND no outstanding todos → nothing to do.
    if (!overThreshold && !todoReminder) return undefined;

    let workingMessages: TokenEstimatorMessage[] = messages.slice();
    let snipsApplied = 0;

    if (overThreshold && opts.getRegisteredSnips) {
      const snips = opts.getRegisteredSnips();
      if (snips.length > 0) {
        const { messages: pruned, snipsApplied: applied } = applyPendingSnips(messages, snips);
        snipsApplied = applied;
        if (applied > 0) workingMessages = pruned;
      }
    }

    // Build the combined reminder string. Token-pressure reminder fires
    // only when over threshold; todo reminder fires whenever outstanding.
    const systemReminder = overThreshold
      ? buildSystemReminder({
          currentTokens: total,
          threshold: opts.threshold,
          maxTokens,
        })
      : '';

    let combined: string;
    if (systemReminder && todoReminder) combined = `${systemReminder}\n${todoReminder}`;
    else if (systemReminder) combined = systemReminder;
    else combined = todoReminder ?? '';

    if (combined) {
      workingMessages = injectReminderIntoLastUserMessage(workingMessages, combined);
    }

    // Fall back to undefined if nothing actually changed.
    if (snipsApplied === 0 && !combined) return undefined;
    return { messages: workingMessages };
  };
}

/**
 * Prepend `<system-reminder>...</system-reminder>` to the most recent user
 * message's text content. Handles string content + array-of-parts content.
 * If no user message exists, appends a synthetic user message containing
 * the reminder (rare — only on a fresh chat that somehow already crossed
 * threshold).
 */
function injectReminderIntoLastUserMessage(
  messages: TokenEstimatorMessage[],
  reminder: string,
): TokenEstimatorMessage[] {
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const m = out[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') {
      out[i] = { ...m, content: `${reminder}\n\n${m.content}` };
      return out;
    }
    if (Array.isArray(m.content)) {
      const newContent = m.content.slice() as unknown[];
      let injected = false;
      for (let j = 0; j < newContent.length; j += 1) {
        const part = newContent[j];
        if (part && typeof part === 'object' && 'text' in part) {
          const t = (part as { text?: unknown }).text;
          if (typeof t === 'string') {
            newContent[j] = { ...(part as object), text: `${reminder}\n\n${t}` };
            injected = true;
            break;
          }
        }
      }
      if (injected) {
        out[i] = { ...m, content: newContent } as TokenEstimatorMessage;
        return out;
      }
      // No text part found — prepend a synthetic text part so reminder is
      // visible to the LLM.
      newContent.unshift({ type: 'text', text: reminder });
      out[i] = { ...m, content: newContent } as TokenEstimatorMessage;
      return out;
    }
  }
  // No user message exists — append a synthetic one with the reminder.
  out.push({ role: 'user', content: reminder });
  return out;
}
