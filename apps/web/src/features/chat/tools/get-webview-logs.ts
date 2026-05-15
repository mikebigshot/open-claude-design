// get_webview_logs — verifier-only tool. Returns the preview iframe's console
// buffer as a stringified log dump.
//
// Source v2 verbatim: tools-full-schema.json (get_webview_logs entry).
//   - empty input_schema {}
//   - description: "Get console logs and errors from the current webview
//     preview. Call after show_html to check the page rendered cleanly."
//
// Iframe-side: overlay.ts hooks console.log / warn / error / info / debug into
// `window.__cs_logbuf` (a ring buffer capped at the last ~200 entries). When
// AGENT_GET_LOGS arrives, the overlay echoes the buffer.

import { tool } from 'ai';
import { z } from 'zod';

import { requestFromIframe } from './iframe-bridge.js';

const GET_WEBVIEW_LOGS_DESCRIPTION = `Get console logs and errors from the current webview preview. Call after show_html to check the page rendered cleanly.`;

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

function formatLogs(logs: LogEntry[]): string {
  if (!logs.length) return '(no logs)';
  return logs
    .map((l) => {
      const stamp = new Date(l.ts).toISOString();
      return `[${stamp}] [${l.level}] ${l.message}`;
    })
    .join('\n');
}

export interface GetWebviewLogsContext {
  getChatId: () => string;
}

export function getWebviewLogsTool(ctx: GetWebviewLogsContext) {
  return tool({
    description: GET_WEBVIEW_LOGS_DESCRIPTION,
    inputSchema: z.object({}),
    execute: async (_input, { abortSignal }) => {
      try {
        const result = await requestFromIframe<GetLogsResponse>({
          chatId: ctx.getChatId(),
          viewport: 'agent',
          type: 'AGENT_GET_LOGS',
          signal: abortSignal,
        });
        if (!result.ok) {
          return `Error: get_webview_logs returned ok=false`;
        }
        return formatLogs(Array.isArray(result.logs) ? result.logs : []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: ${msg}`;
      }
    },
  });
}
