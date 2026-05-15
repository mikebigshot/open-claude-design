// multi_screenshot — verifier-only. Run a sequence of (code, delay) steps in
// the preview iframe; capture a screenshot after each one. Cap at 12 steps
// per v2 spec. Returns `{ __image_refs: [{__image_ref, path}, ...] }` so W1's
// image-ref dispatcher can lift each entry into an image content block.
//
// Source v2: tools-full-schema.json (multi_screenshot entry).

import { tool } from 'ai';
import { z } from 'zod';

import { requestFromIframe } from './iframe-bridge.js';

const MULTI_SCREENSHOT_DESCRIPTION = `Take multiple screenshots of the current preview (via html-to-image), running a JS snippet before each capture. Useful for screenshotting different states (e.g. different slides, UI states, scroll positions). Max 12 steps per call.`;

const MAX_STEPS = 12;

interface EvalJsResponse {
  type: 'AGENT_EVAL_JS_RESULT';
  requestId: string;
  ok: boolean;
  value?: string;
  error?: string;
}

interface ScreenshotResponse {
  type: 'AGENT_SCREENSHOT_RESULT';
  requestId: string;
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface MultiScreenshotContext {
  getChatId: () => string;
}

const StepSchema = z.object({
  code: z.string().describe('JavaScript to execute in the preview before capturing'),
  delay: z
    .number()
    .optional()
    .describe('Milliseconds to wait after running the code before capturing. Default: 200'),
});

export function multiScreenshotTool(ctx: MultiScreenshotContext) {
  return tool({
    description: MULTI_SCREENSHOT_DESCRIPTION,
    inputSchema: z.object({
      path: z.string().describe('The path of the HTML file currently shown in the preview'),
      steps: z.array(StepSchema).describe('Array of capture steps'),
    }),
    execute: async ({ path, steps }, { abortSignal }) => {
      if (steps.length > MAX_STEPS) {
        return `Error: multi_screenshot supports at most ${MAX_STEPS} steps (got ${steps.length}).`;
      }
      const chatId = ctx.getChatId();
      const refs: Array<{ __image_ref: true; path: string }> = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        try {
          const evalResult = await requestFromIframe<EvalJsResponse>({
            chatId,
            type: 'AGENT_EVAL_JS',
            payload: { code: step.code },
            timeoutMs: 10_000,
            signal: abortSignal,
          });
          if (!evalResult.ok) {
            return `Error: step ${i + 1} eval failed: ${evalResult.error ?? 'unknown'}`;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error';
          return `Error: step ${i + 1} eval threw: ${msg}`;
        }

        const delayMs = step.delay ?? 200;
        if (delayMs > 0) {
          await new Promise<void>((res) => setTimeout(res, Math.min(delayMs, 60_000)));
        }

        try {
          const shotResult = await requestFromIframe<ScreenshotResponse>({
            chatId,
            type: 'AGENT_SCREENSHOT',
            payload: { path },
            timeoutMs: 30_000,
            signal: abortSignal,
          });
          if (!shotResult.ok) {
            return `Error: step ${i + 1} screenshot failed: ${shotResult.error ?? 'unknown'}`;
          }
          if (!shotResult.dataUrl) {
            return `Error: step ${i + 1} screenshot returned without dataUrl`;
          }
          refs.push({ __image_ref: true, path: shotResult.dataUrl });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error';
          return `Error: step ${i + 1} screenshot threw: ${msg}`;
        }
      }
      return { __image_refs: refs };
    },
  });
}
