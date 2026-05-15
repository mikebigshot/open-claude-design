// copy_files — per-file `[{src, dest, move?, asset?}]` batch. `move: true`
// removes the src row after copy (rename). `asset` is forwarded to the
// worker; assets-manifest registration is a Phase 3+ concern (not wired
// here). The worker reuses sha256 so no re-upload happens for identical
// content.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

const DESCRIPTION =
  'Copy or move one or more files. Each entry is `{src, dest}`; set `move:true` to delete the source after copying (rename). Reuses the underlying blob — no re-upload for identical content. Use `asset` to tag the dest as a named asset version.';

const FileEntrySchema = z.object({
  src: z.string().min(1).describe('Source file path.'),
  dest: z.string().min(1).describe('Destination file path.'),
  move: z.boolean().optional().describe('If true, delete src after copy (rename).'),
  asset: z.string().optional().describe('Optional asset name to register the dest under.'),
});

interface CopyResult {
  src: string;
  dest: string;
  moved: boolean;
}

interface CopyResponse {
  ok: true;
  results: CopyResult[];
}

function formatResults(results: CopyResult[]): string {
  return results
    .map((r) => `${r.moved ? 'Moved' : 'Copied'} ${r.src} → ${r.dest}`)
    .join('\n');
}

export function copyFilesTool(projectId: string) {
  return tool({
    description: DESCRIPTION,
    inputSchema: z
      .object({
        files: z.array(FileEntrySchema).min(1).max(50),
      })
      .strict(),
    execute: async ({ files }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files/copy`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files }),
        signal: abortSignal,
      });
      if (!res.ok) {
        return `Error: copy_files failed (HTTP ${res.status})`;
      }
      const json = (await res.json()) as CopyResponse;
      return formatResults(json.results ?? []);
    },
  });
}
