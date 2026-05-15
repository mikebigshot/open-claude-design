// screenshot — verifier-only tool. Capture the preview iframe's DOM as a PNG
// data URL via html-to-image (re-render). Returns `{__image_ref: true, path: <dataUrl>}`
// so W1's image-ref dispatcher can lift the value into an image content block
// on the next LLM turn.
//
// Source v2: tools-full-schema.json + artifacts/tool-implementations/screenshot.js
//   - input_schema: { path: string } required
//   - description must begin with `[verifier-only — main agent: use
//     fork_verifier_agent instead]`
//   - mention html-to-image's DOM re-rendering caveats (filters, clip-path,
//     complex shadows may render inaccurately)

import { tool } from 'ai';
import { z } from 'zod';

import { requestFromIframe } from './iframe-bridge.js';

const SCREENSHOT_DESCRIPTION = `[verifier-only — main agent: use fork_verifier_agent instead] Take a screenshot of the preview pane using html-to-image (DOM re-rendering, not a pixel capture — some CSS features like filters, clip-path, and complex shadows may render inaccurately).`;

interface ScreenshotResponse {
  type: 'AGENT_SCREENSHOT_RESULT';
  requestId: string;
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface ScreenshotContext {
  getChatId: () => string;
}

export function screenshotTool(ctx: ScreenshotContext) {
  return tool({
    description: SCREENSHOT_DESCRIPTION,
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          'The path of the HTML file you expect to be shown in the preview. Must match the file currently open — returns an error if the file is not currently displayed. Use show_html first if needed.',
        ),
    }),
    execute: async ({ path }, { abortSignal }) => {
      try {
        const result = await requestFromIframe<ScreenshotResponse>({
          chatId: ctx.getChatId(),
          type: 'AGENT_SCREENSHOT',
          payload: { path },
          timeoutMs: 30_000,
          signal: abortSignal,
        });
        if (!result.ok) {
          return `Error: ${result.error ?? 'screenshot failed'}`;
        }
        if (!result.dataUrl) {
          return `Error: screenshot returned without dataUrl`;
        }
        return { __image_ref: true as const, path: result.dataUrl };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: ${msg}`;
      }
    },
  });
}
