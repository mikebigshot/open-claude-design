import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function readFileTool(projectId: string) {
  return tool({
    description: 'Read the contents of a file in the project. Returns the full UTF-8 text.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to project root.'),
    }),
    execute: async ({ path }, { abortSignal }) => {
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
      );
      const res = await fetch(url, { method: 'GET', signal: abortSignal });
      if (res.status === 404) {
        return { ok: false, error: 'not_found', path };
      }
      if (!res.ok) {
        throw new Error(`read_file failed: ${res.status} ${res.statusText}`);
      }
      const content = await res.text();
      return { ok: true, path, content };
    },
  });
}
