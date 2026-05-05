import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function grepTool(projectId: string) {
  return tool({
    description:
      'Search file contents in the project. Returns up to 1000 matches as {path, line, text}. Use `include` to filter by path substring (e.g. "src/").',
    inputSchema: z.object({
      pattern: z.string().describe('Substring to search for.'),
      include: z.string().optional().describe('Optional path filter (substring match).'),
    }),
    execute: async ({ pattern, include }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/grep`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pattern, ...(include ? { include } : {}) }),
        signal: abortSignal,
      });
      if (!res.ok) throw new Error(`grep failed: ${res.status}`);
      const json = (await res.json()) as {
        matches: { path: string; line: number; text: string }[];
        truncated: boolean;
      };
      return { ok: true as const, matches: json.matches, truncated: json.truncated };
    },
  });
}
