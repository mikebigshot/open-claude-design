// chars/4 token estimator (v2 reference: main-agent-loop-full.raw.js `w4`).
// Used by §2.1 snip trigger (prepareStep) and §2.2 system-reminder nudge to
// decide whether the next LLM call would exceed the model's context window.
//
// We deliberately keep this dependency-free (no @anthropic-ai/tokenizer):
// the estimator only needs to be *directionally* right — within ±15% of the
// real tokenizer is enough to fire the snip threshold a few hundred tokens
// early/late, which still leaves plenty of buffer.

/**
 * Loose AI-SDK ModelMessage shape — keeps this helper independent of AI SDK
 * type churn. Any object with a `role` and a `content` (string or array of
 * parts) is acceptable.
 */
export interface TokenEstimatorMessage {
  role: string;
  content: unknown;
}

/** Estimate tokens for a single message via stringified-content / 4. */
export function estimateMessageTokens(message: TokenEstimatorMessage): number {
  const { content } = message;
  if (content == null) return 0;
  if (typeof content === 'string') {
    if (content.length === 0) return 0;
    return Math.ceil(content.length / 4);
  }
  // Array (multipart) or object — JSON.stringify so structured blocks
  // (tool_use input, tool_result output) contribute their text content.
  let serialized: string;
  try {
    serialized = JSON.stringify(content);
  } catch {
    // Cyclic refs (shouldn't happen with ModelMessage but defensive).
    serialized = String(content);
  }
  if (serialized === '[]' || serialized === '{}') return 0;
  return Math.ceil(serialized.length / 4);
}

/** Sum estimateMessageTokens across an array. */
export function estimateTokens(messages: readonly TokenEstimatorMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}
