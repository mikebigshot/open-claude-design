// eval_js_user_view — main-only sibling of eval_js. Operates on the USER's
// preview pane (not the verifier's iframe). For our MVP both surfaces the same
// iframe per chat; the distinction lives in name + description so the LLM
// picks the right tool. This stays consistent with v2 protocol.
//
// Source: tools-full-schema.json (eval_js_user_view entry).

import { tool } from 'ai';
import { z } from 'zod';

import { requestFromIframe } from './iframe-bridge.js';

const EVAL_JS_USER_VIEW_DESCRIPTION = `Execute JavaScript in the USER's preview pane (not your own iframe). Only use when you need to read state that cannot be reproduced in your iframe — live media streams, file-input previews, permission-gated APIs, or after the user explicitly asks you to look at what they are seeing. For all normal DOM/style queries, use eval_js instead.

The user may have navigated away or be interacting with the page; results reflect their current state, which may differ from yours.`;

interface EvalJsResponse {
  type: 'AGENT_EVAL_JS_RESULT';
  requestId: string;
  ok: boolean;
  value?: string;
  error?: string;
}

export interface EvalJsUserViewContext {
  getChatId: () => string;
}

export function evalJsUserViewTool(ctx: EvalJsUserViewContext) {
  return tool({
    description: EVAL_JS_USER_VIEW_DESCRIPTION,
    inputSchema: z.object({
      code: z
        .string()
        .describe(
          `JavaScript to execute in the user's preview. Last expression's value is returned.`,
        ),
    }),
    execute: async ({ code }, { abortSignal }) => {
      try {
        const result = await requestFromIframe<EvalJsResponse>({
          chatId: ctx.getChatId(),
          type: 'AGENT_EVAL_JS',
          payload: { code },
          timeoutMs: 10_000,
          signal: abortSignal,
        });
        if (!result.ok) {
          return `Error: ${result.error ?? 'eval_js_user_view failed'}`;
        }
        return result.value ?? 'undefined';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: ${msg}`;
      }
    },
  });
}
