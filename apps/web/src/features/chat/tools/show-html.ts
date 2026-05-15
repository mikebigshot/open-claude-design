// show_html — load a file into the agent's own preview iframe.
//
// Routing is by viewportKey (= chatId). Verifier sub-agents have chatId
// `<main-id>::verifier`; the host renders a per-viewport iframe so the
// verifier inspects its own copy without touching the user's pane.
//
// Main-agent path: nudge the agent to call `done` first (which surfaces a
// working view to the user and scans for errors). The nudge fires once per
// chat by setting the same gate `done` uses, so a second show_html proceeds
// normally even if the agent decides to ignore the suggestion.

import { tool } from 'ai';
import { z } from 'zod';

import { hasDoneFired, markDone } from '../lib/done-gate.js';

export interface ShowHtmlContext {
  getChatId: () => string;
}

const EMPTY_PATH = 'Error: `show_html` requires a non-empty file path.';

const ADVISORY_NUDGE =
  'Before self-inspecting: consider calling `done` first to surface your work-in-progress to the user, then `fork_verifier_agent`. The verifier checks in its own context so yours stays clean, and the user gets to see what you\'ve built so far. (This nudge fires once — call show_html again to proceed anyway.)';

export function showHtmlTool(ctx: ShowHtmlContext) {
  return tool({
    description:
      "Open an HTML file in YOUR preview iframe (not the user's pane). Use this before get_webview_logs to check the page loads cleanly. The user's tab bar is not affected — call show_to_user when you want to surface a file in their view.",
    inputSchema: z
      .object({
        path: z.string().min(1).describe('Path of the HTML file to load.'),
      })
      .strict(),
    execute: async ({ path }) => {
      const chatId = ctx.getChatId();
      // Main-agent nudge — fires once per chat. Verifier sub-agents
      // (chatId contains "::") skip the gate entirely.
      if (!chatId.includes('::') && !hasDoneFired(chatId)) {
        markDone(chatId);
        return ADVISORY_NUDGE;
      }
      const trimmed = String(path ?? '').trim();
      if (!trimmed) return EMPTY_PATH;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('agent-show-file', {
            detail: { filePath: trimmed, viewportKey: chatId },
          }),
        );
      }
      return `Opened ${trimmed} in your iframe. Call get_webview_logs to check for rendering errors.`;
    },
  });
}
