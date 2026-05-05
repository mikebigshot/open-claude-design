import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function copyFilesTool(projectId: string) {
  return tool({
    description:
      'Copy one or more files into a destination directory in the same project. Useful for pulling design system / UI kit assets into your working folder. Reuses the underlying blob — no re-upload.',
    inputSchema: z.object({
      sources: z.array(z.string()).min(1).max(50).describe('Source file paths.'),
      dest_dir: z.string().describe('Destination directory path (with or without trailing slash).'),
    }),
    execute: async ({ sources, dest_dir }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files/copy`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sources, destDir: dest_dir }),
        signal: abortSignal,
      });
      if (!res.ok) throw new Error(`copy_files failed: ${res.status}`);
      const { copied } = (await res.json()) as { copied: { from: string; to: string }[] };
      return { ok: true as const, copied };
    },
  });
}
