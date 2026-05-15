// findUnforkedDone — detects the "done called but fork_verifier_agent
// skipped" pattern. Returns `{ doneToolCallId }` for the unforked done, or
// null if no nudge is required.
//
// Rule (handoff §P1 option 3):
//   1. Find the most recent assistant tool_use part with
//      `type = 'tool-done'` and `state = 'output-available'`.
//   2. Scan messages AFTER that done. If any assistant message contains a
//      `tool-fork_verifier_agent` (any state >= input-available), the
//      verifier was forked → no nudge.
//   3. Otherwise: if the LAST assistant message after done has no tool_use
//      parts (text-only or nothing) → nudge (return the done's toolCallId).
//   4. If the last assistant message has some OTHER tool_use (write_file,
//      screenshot, etc.), the loop is still in flight → no nudge yet.
//   5. If `done` is the most recent assistant message and there's nothing
//      after it, treat that as "loop ended without fork" → nudge.

import type { DesignAgentUIMessage } from '../ui-messages.js';

export interface UnforkedDoneFinding {
  /** The toolCallId of the done call that should have been followed by a fork. */
  doneToolCallId: string;
}

interface PartShape {
  type?: string;
  state?: string;
  toolCallId?: string;
}

function partsOf(msg: DesignAgentUIMessage): readonly PartShape[] {
  return (msg.parts ?? []) as readonly PartShape[];
}

function hasOutputAvailableDone(msg: DesignAgentUIMessage): {
  toolCallId: string | undefined;
} | null {
  for (const part of partsOf(msg)) {
    if (part.type === 'tool-done' && part.state === 'output-available') {
      return { toolCallId: part.toolCallId };
    }
  }
  return null;
}

function hasForkVerifier(msg: DesignAgentUIMessage): boolean {
  for (const part of partsOf(msg)) {
    if (part.type === 'tool-fork_verifier_agent') return true;
  }
  return false;
}

function isToolUsePart(part: PartShape): boolean {
  return typeof part.type === 'string' && part.type.startsWith('tool-');
}

function assistantHasAnyToolUse(msg: DesignAgentUIMessage): boolean {
  for (const part of partsOf(msg)) {
    if (isToolUsePart(part)) return true;
  }
  return false;
}

export function findUnforkedDone(
  messages: readonly DesignAgentUIMessage[],
): UnforkedDoneFinding | null {
  // 1. Scan from the end for the latest output-available done.
  let lastDoneIdx = -1;
  let doneToolCallId: string | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    const found = hasOutputAvailableDone(m);
    if (found) {
      lastDoneIdx = i;
      doneToolCallId = found.toolCallId;
      break;
    }
  }
  if (lastDoneIdx < 0 || !doneToolCallId) return null;

  // 2. Did any later assistant message call fork_verifier_agent?
  for (let i = lastDoneIdx + 1; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    if (hasForkVerifier(m)) return null;
  }

  // 3. Find the most-recent assistant message AFTER the done.
  let lastAssistantAfter: DesignAgentUIMessage | null = null;
  for (let i = messages.length - 1; i > lastDoneIdx; i -= 1) {
    const m = messages[i];
    if (m && m.role === 'assistant') {
      lastAssistantAfter = m;
      break;
    }
  }

  if (!lastAssistantAfter) {
    // done was the last assistant turn — loop ended without fork.
    return { doneToolCallId };
  }
  // 4. Other tool_use after done — still in flight, no nudge yet.
  if (assistantHasAnyToolUse(lastAssistantAfter)) return null;
  // 5. Text-only response — fork was skipped.
  return { doneToolCallId };
}

/**
 * Reminder text injected as a user message when {@link findUnforkedDone}
 * returns a finding. Wording mirrors the v2 nudge in `done.ts` but is more
 * direct since this is a follow-up rather than a hint.
 */
export const POST_DONE_NUDGE_TEXT =
  "You called `done` but didn't call `fork_verifier_agent`. " +
  'For non-trivial changes you MUST fork the verifier so the work is QA-checked before the user sees it. ' +
  'Call `fork_verifier_agent` now. ' +
  'If the change was trivial (a single-line tweak / typo fix / colour change), reply explaining why and the user will decide.';
