// eval_js — verifier-only. Run JS in the preview iframe and return the
// stringified result. Timeout 10s per v2 spec.
//
// Source v2 verbatim: tools-full-schema.json + artifacts/tool-implementations/eval_js.js
//   - input_schema: { code: string } required
//   - description must start with `[verifier-only — main agent: use
//     fork_verifier_agent instead]`
//   - return: stringified value, or `Error: <message>` on failure / timeout

import { tool } from 'ai';
import { z } from 'zod';

import { requestFromIframe } from './iframe-bridge.js';

const EVAL_JS_DESCRIPTION = `[verifier-only — main agent: use fork_verifier_agent instead] Execute JavaScript code in the preview webview and return the result.

Use this to:
- Query the DOM (e.g., document.querySelectorAll('.btn').length)
- Check computed styles (e.g., getComputedStyle(el).color)
- Test interactive behavior (e.g., click buttons, check state)
- Read text content or attributes from elements

The code runs in the context of the preview page. Return values are JSON-serialized.
Timeout: 10 seconds. Errors (syntax, runtime, timeout) are returned as error messages.

Examples:
- "document.title" → returns the page title
- "document.querySelectorAll('button').length" → returns button count
- "[...document.querySelectorAll('h1')].map(el => el.textContent)" → returns array of h1 texts`;

interface EvalJsResponse {
  type: 'AGENT_EVAL_JS_RESULT';
  requestId: string;
  ok: boolean;
  value?: string;
  error?: string;
}

export interface EvalJsContext {
  getChatId: () => string;
}

export function evalJsTool(ctx: EvalJsContext) {
  return tool({
    description: EVAL_JS_DESCRIPTION,
    inputSchema: z.object({
      code: z
        .string()
        .describe(`JavaScript code to execute. The last expression's value is returned.`),
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
          return `Error: ${result.error ?? 'eval_js failed'}`;
        }
        return result.value ?? 'undefined';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: ${msg}`;
      }
    },
  });
}
