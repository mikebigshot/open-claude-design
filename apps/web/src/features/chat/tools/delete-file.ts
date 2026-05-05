import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function deleteFileTool(projectId: string) {
  return tool({
    description: 'Delete a file from the project.',
    inputSchema: z.object({
      path: z.string().describe('File path to delete (relative to project root).'),
    }),
    execute: async ({ path }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`);
      const res = await fetch(url, { method: 'DELETE', signal: abortSignal });
      if (res.status === 404) return { ok: false as const, error: 'not_found' as const };
      if (!res.ok) throw new Error(`delete_file failed: ${res.status}`);
      return { ok: true as const };
    },
  });
}
