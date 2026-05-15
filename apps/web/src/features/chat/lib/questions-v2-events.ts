// questions-v2-events — host-side listener bus for the questions_v2 tool.
//
// The tool's execute() fires `questions-v2-show` CustomEvent on `window`.
// Hosts (ChatPanel) consume the latest dispatch via `useQuestionsV2Listener`
// so the form surface is independent of the chat message stream — it
// survives snip drops, history rehydration, and message replays where the
// `tool-questions_v2` part may not be visible anymore.

import { useEffect, useState } from 'react';

import type { QuestionsV2InputT } from '../tools/questions-v2.js';

export interface PendingQuestionsV2 {
  spec: QuestionsV2InputT;
  toolCallId: string;
}

/** Internal: shape carried on the `questions-v2-show` CustomEvent. */
interface QuestionsV2EventDetail {
  spec: QuestionsV2InputT;
  toolCallId: string;
}

/**
 * Subscribe to the most recent `questions-v2-show` event. Returns the
 * latest pending question spec (or `null` if none has fired since mount).
 *
 * Replacement semantics: only the most recent dispatch is kept — earlier
 * unanswered prompts are superseded. This matches the agent's expected
 * behavior (one open form at a time per chat).
 */
export function useQuestionsV2Listener(): PendingQuestionsV2 | null {
  const [pending, setPending] = useState<PendingQuestionsV2 | null>(null);
  useEffect(() => {
    const onShow = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as QuestionsV2EventDetail | undefined;
      if (!detail || !detail.spec) return;
      setPending({ spec: detail.spec, toolCallId: detail.toolCallId });
    };
    window.addEventListener('questions-v2-show', onShow);
    return () => window.removeEventListener('questions-v2-show', onShow);
  }, []);
  return pending;
}

/**
 * Programmatic dismiss for hosts that handle submit/cancel — clears the
 * pending state so the panel hides. Implemented as a separate dispatcher
 * to keep the listener hook pure (read-only of event state).
 */
export function dismissPendingQuestionsV2(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('questions-v2-dismiss'));
}
