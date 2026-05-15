// done — surfaces a file to the user, scans the preview iframe's console for
// errors, and flips the per-chat done-gate on clean runs.
//
// Required side effects:
//   (1) dispatch a `CustomEvent('agent-show-file', { detail: { filePath,
//       viewportKey: chatId, target: 'user' } })` on `window` — the host
//       shell listens for this to switch the user-visible iframe's active
//       file tab to `path`. This always fires, even when the preview iframe
//       is unreachable, because the event is the host's primary signal.
//   (2) request the preview iframe's captured console buffer via the
//       AGENT_GET_LOGS RPC (same path `get_webview_logs` uses). Filter for
//       `level === 'error'` (our overlay's equivalent of official's
//       `type === 'error' | 'resource_error'`).
//   (3) On a clean buffer, call `markDone(chatId)` so the verifier-fork tool
//       gate flips on (`hasDoneFired` returns true thereafter).
//
// The fork_verifier_agent tool checks `hasDoneFired` for the same chatId
// when no `task` argument is provided — i.e. full-sweep mode. Without this
// gate flip, full-sweep forks are rejected with the official message
// "Error: call `done` first ...". Directed-check mode (with `task`) bypasses
// the gate.

import { tool } from 'ai';
import { z } from 'zod';

import { markDone } from '../lib/done-gate.js';
import { requestFromIframe } from './iframe-bridge.js';

const FORK_VERIFIER_NUDGE =
  'Next: call fork_verifier_agent (or end your turn if this was a trivial tweak).';

const EMPTY_PATH_ERROR = 'Error: `done` requires a non-empty file path.';

interface LogEntry {
  level: string;
  message: string;
  ts: number;
}

interface GetLogsResponse {
  type: 'AGENT_GET_LOGS_RESULT';
  requestId: string;
  ok: true;
  logs: LogEntry[];
}

export interface DoneToolContext {
  /** Lazy getter — read the chat id at execute time, not tool-build time. */
  getChatId: () => string;
}

function dispatchAgentShowFile(filePath: string, viewportKey: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('agent-show-file', {
      detail: { filePath, viewportKey, target: 'user' },
    }),
  );
}

export function doneTool(ctx: DoneToolContext) {
  return tool({
    description:
      "Finish your turn: open `path` in the user's tab bar, wait for it to load, and return console errors (if any). This guarantees the user lands on a working view before background verification runs. If errors come back, fix them and call done again. If clean, call fork_verifier_agent next (or end your turn for trivial tweaks). You MUST call done before fork_verifier_agent — the verifier won't fork without it.",
    inputSchema: z.object({
      path: z.string().min(1).describe('HTML file to surface to the user.'),
    }),
    execute: async ({ path }, { abortSignal }) => {
      const trimmed = String(path ?? '').trim();
      if (!trimmed) {
        return EMPTY_PATH_ERROR;
      }

      const chatId = ctx.getChatId();
      dispatchAgentShowFile(trimmed, chatId);

      // Pull the preview iframe's console buffer. If the iframe isn't
      // reachable (no matching `<iframe data-chat-id>`, RPC timeout, etc.),
      // we cannot verify cleanliness — return an explicit error string and
      // leave the gate closed so the verifier fork is refused until the
      // user retries with a working preview.
      let logs: LogEntry[];
      try {
        const result = await requestFromIframe<GetLogsResponse>({
          chatId,
          viewport: 'user',
          type: 'AGENT_GET_LOGS',
          signal: abortSignal,
        });
        if (!result.ok) {
          return `Error: could not read console logs for ${trimmed} (AGENT_GET_LOGS returned ok=false). Retry once the preview is ready.`;
        }
        logs = Array.isArray(result.logs) ? result.logs : [];
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: could not read console logs for ${trimmed} (${msg}). Retry once the preview iframe is mounted.`;
      }

      const errors = logs.filter((l) => l.level === 'error');

      if (errors.length > 0) {
        const formatted = errors.map((l) => `[${l.level}] ${l.message}`).join('\n');
        return `Opened ${trimmed} for the user. ${errors.length} console error(s):\n\n${formatted}\n\nFix these before calling fork_verifier_agent. Call done again when fixed.`;
      }

      markDone(chatId);
      return `Opened ${trimmed} for the user. No console errors.\n\n${FORK_VERIFIER_NUDGE}`;
    },
  });
}
