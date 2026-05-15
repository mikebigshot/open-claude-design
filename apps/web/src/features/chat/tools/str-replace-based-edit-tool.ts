import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function strReplaceBasedEditTool(projectId: string) {
  return tool({
    description:
      'Replace a unique substring in an existing file. `old_str` must match exactly once. Use this for surgical edits — much cheaper than re-emitting a whole file with `write_file`.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to project root.'),
      old_str: z.string().describe('Substring to find. Must be unique within the file.'),
      new_str: z.string().describe('Replacement text.'),
    }),
    execute: async ({ path, old_str, new_str }, { abortSignal }) => {
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
      );
      const getRes = await fetch(url, { signal: abortSignal });
      if (!getRes.ok) {
        return { ok: false as const, error: 'not_found' as const };
      }
      const content = await getRes.text();
      const count = content.split(old_str).length - 1;
      if (count === 0) return { ok: false as const, error: 'not_found' as const };
      if (count > 1) return { ok: false as const, error: 'multiple_matches' as const, count };
      const next = content.replace(old_str, new_str);
      const putRes = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: next }),
        signal: abortSignal,
      });
      if (!putRes.ok) throw new Error(`str_replace failed: ${putRes.status}`);
      const { sha256, size } = (await putRes.json()) as { sha256: string; size: number };
      return { ok: true as const, path, sha256, size };
    },
  });
}
