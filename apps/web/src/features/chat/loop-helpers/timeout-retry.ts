// timeout-retry — §2.4 helper.
//
// When `streamText` throws a timeout-shaped error and produced no content,
// Anthropic's main loop pushes a synthetic user message asking the agent
// to split the next response, then re-issues the call. Up to rN=2 retries
// before the original error escapes.
//
// We currently bind these to streamText via the AI SDK's onError /
// experimental hooks (or as a thrown-error filter inside the existing
// ToolLoopAgent flow). Helper is pure so the wire-up is testable in
// isolation.

/**
 * Verbatim from v2 main-agent-loop-full.raw.js. The `System:` prefix is
 * intentional — it signals to the model this isn't real user input.
 */
export const TIMEOUT_RETRY_INJECT_TEXT =
  'System: your past response was too long and the connection timed out before it could be delivered. Try splitting it up into smaller edits or smaller components.';

const TIMEOUT_PATTERN = /timed[\s_-]?out|timeout/i;

export function isTimeoutLikeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown };
  if (typeof e.name === 'string' && /timeout/i.test(e.name)) return true;
  if (typeof e.message === 'string' && TIMEOUT_PATTERN.test(e.message)) return true;
  return false;
}

export interface TimeoutRetryHandler {
  readonly max: number;
  readonly attempts: number;
  /**
   * Bumps `attempts` and returns true if we still have budget. Returns
   * false the call AFTER `max` is reached, signaling "give up, throw".
   */
  shouldRetry(): boolean;
  reset(): void;
}

export function makeTimeoutRetryHandler(opts: { max?: number } = {}): TimeoutRetryHandler {
  const max = opts.max ?? 2;
  let attempts = 0;
  return {
    max,
    get attempts() {
      return attempts;
    },
    shouldRetry(): boolean {
      if (attempts >= max) return false;
      attempts += 1;
      return true;
    },
    reset(): void {
      attempts = 0;
    },
  };
}
