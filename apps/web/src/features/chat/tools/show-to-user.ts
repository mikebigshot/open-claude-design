// show_to_user — switch the user's tab bar to the named file (Phase 2 / A1).
//
// Unlike `done`, this does NOT scan the console for errors or flip the
// done-gate. It's a pure UI nudge — useful for mid-task hand-offs ("here's
// the slide deck so far") that aren't yet a turn-ending deliverable.

import { tool } from 'ai';
import { z } from 'zod';

export interface ShowToUserContext {
  getChatId: () => string;
}

const EMPTY_PATH = 'Error: `show_to_user` requires a non-empty file path.';

export function showToUserTool(ctx: ShowToUserContext) {
  return tool({
    description:
      "Switch the user's tab bar to a specific file in the project. Use mid-task to surface an in-progress artifact without ending your turn or running verification (use `done` for turn-ending surfaces instead — it scans for console errors and flips the verifier-fork gate).",
    inputSchema: z
      .object({
        path: z.string().min(1).describe("File to open in the user's tab bar."),
      })
      .strict(),
    execute: async ({ path }) => {
      const trimmed = String(path ?? '').trim();
      if (!trimmed) return EMPTY_PATH;
      const chatId = ctx.getChatId();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('agent-show-file', {
            detail: { filePath: trimmed, viewportKey: chatId, target: 'user' },
          }),
        );
      }
      return `Opened ${trimmed} in the user's tab bar.`;
    },
  });
}
