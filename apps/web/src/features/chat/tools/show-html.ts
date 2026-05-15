// show_html — load a file into the AGENT-PRIVATE iframe (Phase 2 / A1).
//
// The agent-private pane is a hidden iframe rendered alongside the user's
// preview pane. It lets the verifier sub-agent run eval_js / screenshot
// against an arbitrary file without disturbing what the user is looking at.
//
// Dispatches `agent-show-file` CustomEvent with target='agent'; the host
// shell listens to this and updates the agent-private iframe's src.

import { tool } from 'ai';
import { z } from 'zod';

export interface ShowHtmlContext {
  getChatId: () => string;
}

const EMPTY_PATH = 'Error: `show_html` requires a non-empty file path.';

export function showHtmlTool(ctx: ShowHtmlContext) {
  return tool({
    description:
      'Load an HTML file into YOUR (agent-private) iframe — separate from the user\'s preview pane. Use this before eval_js / screenshot when you need to inspect a file without changing what the user sees. Returns once the load is requested; pair with screenshot or get_webview_logs to confirm the page rendered cleanly.',
    inputSchema: z
      .object({
        path: z.string().min(1).describe('Path of the HTML file to load.'),
      })
      .strict(),
    execute: async ({ path }) => {
      const trimmed = String(path ?? '').trim();
      if (!trimmed) return EMPTY_PATH;
      const chatId = ctx.getChatId();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('agent-show-file', {
            detail: { filePath: trimmed, viewportKey: chatId, target: 'agent' },
          }),
        );
      }
      return `Opened ${trimmed} in your iframe (agent-private pane). The user's pane is unchanged.`;
    },
  });
}
