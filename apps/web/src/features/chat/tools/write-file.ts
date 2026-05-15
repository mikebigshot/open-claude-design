import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function writeFileTool(projectId: string) {
  return tool({
    description:
      'Create or overwrite a file in the project. Use for any code/markup/style file (.jsx, .tsx, .html, .css, .js, .json, .md, .svg, .txt). Path is relative to the project root. Pass `asset: "<name>"` for user-facing deliverables (HTML pages, decks, etc.) so they appear in the project asset list; omit for support files (CSS, components, research notes).',
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          'File path relative to project root (e.g. "App.jsx", "src/components/Header.tsx").',
        ),
      content: z.string().describe('Full file content to write. UTF-8 text.'),
      asset: z
        .string()
        .optional()
        .describe(
          'User-facing asset name shown in the project asset list. Omit for support files.',
        ),
      mimeType: z
        .string()
        .optional()
        .describe('MIME type. If omitted, server infers from extension.'),
    }),
    execute: async ({ path, content, asset, mimeType }, { abortSignal }) => {
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
      );
      const body: Record<string, unknown> = { content };
      if (asset !== undefined) body.asset = asset;
      if (mimeType !== undefined) body.mimeType = mimeType;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
      if (!res.ok) throw new Error(`write_file failed: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { sha256: string; size: number };
      return { ok: true, path, sha256: json.sha256, size: json.size };
    },
  });
}
