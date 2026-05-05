// Host-side handler for the iframe's window.claude.complete() RPC.
//
// Behavior:
//   - Force a fast / cheap model (per-provider Haiku-equivalent)
//   - 1024 max tokens
//   - 30s timeout per chunk (enforced overlay-side; we just forward chunks)
//
// Channel: same BYOK key the chat agent uses, but routed through whichever
// provider the user selected (`getModelPref().provider`). Vercel AI SDK's
// `streamText` normalizes the response shape across providers — no more
// per-provider SSE-parsing.

import { streamText } from 'ai';
import { byokKey } from './byok-key';
import { getModelPref } from './model-pref';
import { buildFastModel } from './llm-providers';
import { PROVIDER_LABELS } from '@open-design/contracts';

const MAX_TOKENS = 1024;

export interface ClaudeCompleteCallbacks {
  /** Streamed token chunks (delta only; concatenate to get full text). */
  onChunk: (chunk: string) => void;
}

/**
 * Run a fast-model completion, streaming chunks via the callback.
 *
 * Resolves with the full text once the stream ends. Rejects on network
 * errors, missing key, or upstream failures (re-thrown by the SDK).
 */
export async function claudeComplete(
  prompt: string,
  cb: ClaudeCompleteCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  const { provider } = getModelPref();
  const key = byokKey.get(provider);
  if (!key) {
    throw new Error(
      `No ${PROVIDER_LABELS[provider]} API key configured. Open Settings to add one.`,
    );
  }

  const result = streamText({
    model: buildFastModel(provider, key),
    prompt,
    maxOutputTokens: MAX_TOKENS,
    abortSignal: signal,
  });

  let full = '';
  for await (const chunk of result.textStream) {
    full += chunk;
    cb.onChunk(chunk);
  }
  return full;
}
