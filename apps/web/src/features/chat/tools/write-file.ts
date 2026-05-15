// write_file — create/overwrite a UTF-8 text file. Aligned behavior:
//   - reject paths containing `#` (URL fragment identifier breaks navigation)
//   - accept `viewport` + `subtitle` metadata params alongside `asset`
//   - dispatch `file-written` CustomEvent after a successful write so the
//     host shell can refresh file-tree caches / preview pane
//   - return "Wrote N characters to <path>" bare string
//
// The worker accepts the extra fields (asset / viewport / subtitle / mimeType)
// in the JSON body; assets-manifest propagation is owned by the worker (or
// deferred to a later phase if not yet wired).

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

const POUND_REJECT =
  'Error: "#" is not allowed in file paths — it is treated as a URL fragment identifier and breaks navigation. Choose a path without "#".';

const ViewportSchema = z.object({
  width: z.number().int().positive().describe('Design width in px.'),
  height: z.number().int().positive().optional().describe('Intended height cap in px.'),
});

function dispatchFileWritten(path: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('file-written', { detail: { path } }));
}

export function writeFileTool(projectId: string) {
  return tool({
    description:
      'Create or overwrite a file in the project. Use for any code / markup / style file (.jsx, .tsx, .html, .css, .js, .json, .md, .svg, .txt). Path is relative to project root. Pass `asset: "<name>"` for user-facing deliverables (HTML pages, decks, etc.) so they appear in the project asset list. Use `viewport` / `subtitle` to tag the version with intended design width and a short label.',
    inputSchema: z
      .object({
        path: z
          .string()
          .min(1)
          .describe('File path relative to project root (e.g. "src/components/Header.tsx").'),
        content: z.string().describe('Full file content to write. UTF-8 text.'),
        asset: z
          .string()
          .optional()
          .describe('User-facing asset name shown in the project asset list.'),
        subtitle: z
          .string()
          .optional()
          .describe('Short description of this version (e.g. "Indigo primary, slate neutrals").'),
        viewport: ViewportSchema.optional().describe(
          'Design viewport — {width, height?} in px.',
        ),
        mimeType: z
          .string()
          .optional()
          .describe('MIME type. If omitted, server infers from extension.'),
      })
      .strict(),
    execute: async (
      { path, content, asset, subtitle, viewport, mimeType },
      { abortSignal },
    ) => {
      if (path.includes('#')) {
        return POUND_REJECT;
      }
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
      );
      const body: Record<string, unknown> = { content };
      if (asset !== undefined) body.asset = asset;
      if (subtitle !== undefined) body.subtitle = subtitle;
      if (viewport !== undefined) body.viewport = viewport;
      if (mimeType !== undefined) body.mimeType = mimeType;

      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
      if (!res.ok) {
        return `Error: write_file failed (HTTP ${res.status} ${res.statusText})`;
      }
      dispatchFileWritten(path);
      return `Wrote ${content.length} characters to ${path}`;
    },
  });
}
