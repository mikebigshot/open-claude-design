// user-message-queue — §2.2 helper.
//
// When the user sends a message while the agent is streaming, we want it to
// be queued and delivered as part of the NEXT user message (alongside any
// tool_results), wrapped in `<user_message>...</user_message>` XML tags so
// the model can distinguish queued user input from tool feedback.
//
// v2 verbatim wrapping (from main-agent-loop-full.raw.js):
//   const xt = `<user_message>\n${$e}\n</user_message>`;
// We omit the surrounding newlines because the AI SDK's content blocks
// already separate parts — adding them would double-space the model's view.

export const USER_MESSAGE_OPEN = '<user_message>' as const;
export const USER_MESSAGE_CLOSE = '</user_message>' as const;

/** Wrap one queued text block. */
export function wrapPendingUserMessage(text: string): string {
  return `${USER_MESSAGE_OPEN}${text}${USER_MESSAGE_CLOSE}`;
}

/**
 * Wrap a queue of N pending messages into one combined string. Each entry
 * gets its own `<user_message>` wrapper (so the model sees them as
 * sequential user inputs). Whitespace-only entries are dropped — they're
 * almost always artifacts of UI form-submit eating a trailing space.
 */
export function wrapPendingUserMessages(queued: readonly string[]): string {
  const wrapped: string[] = [];
  for (const text of queued) {
    if (text.trim().length === 0) continue;
    wrapped.push(wrapPendingUserMessage(text));
  }
  return wrapped.join('\n');
}
