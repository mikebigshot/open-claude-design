// open_for_print — opens a project file (typically a deck or document HTML)
// in a new browser tab so the user can use the OS print dialog to save as
// PDF. Mirrors v2 official tool name + input schema.
//
// We don't generate the PDF in-process: browser-side PDF libraries (`jsPDF`,
// `html2pdf`) produce subtly wrong layouts compared to the OS rasterizer.
// `Save as PDF` skill is the consumer; the agent calls this tool, the host
// opens a new tab pointing at the file URL, the user prints to PDF.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

type OpenForPrintInput = { project_relative_file_path: string };
type OpenForPrintOutput =
  | { ok: true; message: string; url: string }
  | { ok: false; error: 'invalid_path'; message: string }
  | { ok: false; error: 'popup_blocked'; message: string };

type OpenWindowFn = (url: string) => Window | null;

/**
 * Build the file-fetch URL the worker exposes for project files. Forward
 * slashes inside the path are preserved (they're part of the project tree),
 * spaces and other reserved characters in segments are encoded.
 */
function buildFileUrl(projectId: string, path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  // Encode each path segment individually so subdirectories stay readable.
  const encoded = trimmed
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files/${encoded}`);
}

/**
 * @param openWindow override used by tests. Production code defaults to
 * `window.open(url, '_blank')` — which DOES work for tool-initiated opens
 * in Chrome/Safari/Firefox when the user has actively been in the page
 * within the last few seconds (typical for agent loop turn flow).
 */
export function openForPrintTool(projectId: string, openWindow?: OpenWindowFn) {
  const open: OpenWindowFn =
    openWindow ?? ((url: string) => (typeof window !== 'undefined' ? window.open(url, '_blank') : null));

  return tool<OpenForPrintInput, OpenForPrintOutput>({
    description:
      'Open an HTML file in a new browser tab for printing / saving as PDF. The user can then press Cmd+P (Mac) or Ctrl+P (Windows) to save as PDF.',
    inputSchema: z.object({
      project_relative_file_path: z.string().describe('Path relative to project root'),
    }),
    execute: async ({ project_relative_file_path }) => {
      const path = (project_relative_file_path ?? '').trim();
      if (!path) {
        return {
          ok: false,
          error: 'invalid_path',
          message: 'project_relative_file_path is required and cannot be empty.',
        };
      }
      const url = buildFileUrl(projectId, path);
      const w = open(url);
      if (!w) {
        return {
          ok: false,
          error: 'popup_blocked',
          message:
            'The browser blocked the popup. Ask the user to allow popups for this site and call open_for_print again.',
        };
      }
      return {
        ok: true,
        url,
        message:
          'Opened in a new tab. Tell the user to press Cmd+P (Mac) or Ctrl+P (Windows) and choose "Save as PDF".',
      };
    },
  });
}
