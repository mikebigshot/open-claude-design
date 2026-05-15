// screenshot_user_view — main-only sibling of `screenshot`. Targets the
// USER's preview pane. Returns `{__image_ref: true, path: <dataUrl>}`.
//
// Source: tools-full-schema.json (screenshot_user_view entry).

import { tool } from 'ai';
import { z } from 'zod';

import { requestFromIframe } from './iframe-bridge.js';

const SCREENSHOT_USER_VIEW_DESCRIPTION = `Screenshot the USER's preview pane (not your own iframe). Only use when you need to see state your iframe cannot reproduce — webcam/mic feeds, uploaded-file previews, live data, or when the user explicitly says "look at what I'm seeing". For normal verification, use screenshot instead.

May fail if the user has navigated away from an HTML file or is mid-interaction.`;

interface ScreenshotResponse {
  type: 'AGENT_SCREENSHOT_RESULT';
  requestId: string;
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface ScreenshotUserViewContext {
  getChatId: () => string;
}

export function screenshotUserViewTool(ctx: ScreenshotUserViewContext) {
  return tool({
    description: SCREENSHOT_USER_VIEW_DESCRIPTION,
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }) => {
      try {
        const result = await requestFromIframe<ScreenshotResponse>({
          chatId: ctx.getChatId(),
          type: 'AGENT_SCREENSHOT',
          timeoutMs: 30_000,
          signal: abortSignal,
        });
        if (!result.ok) {
          return `Error: ${result.error ?? 'screenshot_user_view failed'}`;
        }
        if (!result.dataUrl) {
          return `Error: screenshot_user_view returned without dataUrl`;
        }
        return { __image_ref: true as const, path: result.dataUrl };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: ${msg}`;
      }
    },
  });
}
