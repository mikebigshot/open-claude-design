// questions-v2 event bus — host-side listener for the questions_v2 tool.
//
// Three CustomEvents live on `window` (matches claude.ai/design bundle
// Bu8zJzmd lifecycle):
//
//   - questions-v2-show    — final spec arrived from the tool's execute().
//                            Detail: { spec, toolCallId }. streaming=false.
//   - questions-v2-stream  — mid-call partial spec arrives during streaming.
//                            Detail: { spec, toolCallId, done }.
//                            done=false → streaming=true, more ticks coming.
//                            done=true  → streaming=false, this is the final
//                                          partial (followed by -show OR not).
//   - questions-v2-close   — clear the panel (chat changed, user dismissed,
//                            cancellation). No detail.
//
// `useQuestionsV2Listener` subscribes to all three. ChatPanel-level consumers
// see the latest spec independently of the chat message stream so the form
// survives snip / message replay / rehydration where the `tool-questions_v2`
// part is no longer in scope.

import { useEffect, useState } from 'react';

import type { QuestionsV2InputT } from '../tools/questions-v2.js';

export interface PendingQuestionsV2 {
  spec: QuestionsV2InputT;
  toolCallId: string;
  /** True while partial-JSON is still arriving via -stream events. */
  streaming: boolean;
}

interface ShowDetail {
  spec: QuestionsV2InputT;
  toolCallId: string;
}

interface StreamDetail {
  spec: QuestionsV2InputT;
  toolCallId: string;
  done: boolean;
}

/**
 * Subscribe to the most recent `questions-v2-show` / `-stream` / `-close`
 * dispatch. Returns the latest pending question spec (or `null` if none has
 * fired since mount).
 *
 * Replacement semantics: only the most recent dispatch is kept — earlier
 * unanswered prompts are superseded. This matches the agent's expected
 * behavior (one open form at a time per chat).
 */
export function useQuestionsV2Listener(): PendingQuestionsV2 | null {
  const [pending, setPending] = useState<PendingQuestionsV2 | null>(null);
  useEffect(() => {
    const onShow = (ev: Event) => {
      const detail = (ev as CustomEvent<ShowDetail | undefined>).detail;
      if (!detail || !detail.spec) return;
      setPending({ spec: detail.spec, toolCallId: detail.toolCallId, streaming: false });
    };
    const onStream = (ev: Event) => {
      const detail = (ev as CustomEvent<StreamDetail | undefined>).detail;
      if (!detail || !detail.spec) return;
      setPending({
        spec: detail.spec,
        toolCallId: detail.toolCallId,
        streaming: !detail.done,
      });
    };
    const onClose = () => setPending(null);
    window.addEventListener('questions-v2-show', onShow);
    window.addEventListener('questions-v2-stream', onStream);
    window.addEventListener('questions-v2-close', onClose);
    return () => {
      window.removeEventListener('questions-v2-show', onShow);
      window.removeEventListener('questions-v2-stream', onStream);
      window.removeEventListener('questions-v2-close', onClose);
    };
  }, []);
  return pending;
}

/**
 * Emit a `questions-v2-stream` CustomEvent — used by the agent integration
 * when partial JSON arrives mid-call. `done=false` means more ticks are
 * coming; `done=true` means this is the final partial.
 */
export function dispatchQuestionsV2Stream(
  spec: QuestionsV2InputT,
  done: boolean,
  toolCallId = '',
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('questions-v2-stream', { detail: { spec, toolCallId, done } }),
  );
}

/**
 * Emit a `questions-v2-close` CustomEvent — used to clear the panel when the
 * chat changes, the user dismisses, or the tool call is cancelled.
 */
export function dispatchQuestionsV2Close(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('questions-v2-close'));
}

/**
 * @deprecated Use `dispatchQuestionsV2Close()` — the rename aligns with the
 * official `questions-v2-close` CustomEvent name. This alias keeps the old
 * call sites compiling until they are migrated.
 */
export function dismissPendingQuestionsV2(): void {
  dispatchQuestionsV2Close();
}
