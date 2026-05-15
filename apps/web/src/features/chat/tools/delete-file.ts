// delete_file — batch + recursive. Accepts `paths: string[]`; each entry can
// be a single file path (exact match) or a directory path (recursive delete
// of everything under it). Returns a per-path summary string for the LLM.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

const DESCRIPTION =
  'Delete one or more files or folders from the project. Folders are deleted recursively (all files under the folder path are removed).';

interface DeleteResult {
  path: string;
  deleted: number;
}

interface DeleteResponse {
  ok: true;
  results: DeleteResult[];
}

function formatResults(results: DeleteResult[]): string {
  return results
    .map((r) => {
      if (r.deleted === 0) return `No file or folder found at ${r.path} (nothing deleted).`;
      if (r.deleted === 1) return `Deleted ${r.path}`;
      return `Deleted ${r.path} (${r.deleted} files)`;
    })
    .join('\n');
}

export function deleteFileTool(projectId: string) {
  return tool({
    description: DESCRIPTION,
    inputSchema: z
      .object({
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe('File or folder paths to delete (relative to project root).'),
      })
      .strict(),
    execute: async ({ paths }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files/delete`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths }),
        signal: abortSignal,
      });
      if (!res.ok) {
        return `Error: delete_file failed (HTTP ${res.status})`;
      }
      const json = (await res.json()) as DeleteResponse;
      return formatResults(json.results ?? []);
    },
  });
}
