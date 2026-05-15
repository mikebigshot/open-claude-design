// unregister_assets — drop named assets from the project's manifest.
// Uses the new DELETE /api/projects/:id/assets endpoint with {names:[]}
// body. The underlying file rows are untouched — this is purely a manifest
// concern (the assets list shown to the user). Pair with `delete_file` if
// the files should also be removed.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function unregisterAssetsTool(projectId: string) {
  return tool({
    description:
      "Remove one or more named assets from the project's review manifest. The underlying files are NOT deleted (use `delete_file` for that). Use after the user dismisses an asset or you replace it with a different name.",
    inputSchema: z
      .object({
        names: z
          .array(z.string().min(1))
          .min(1)
          .describe('Asset names to remove from the manifest.'),
      })
      .strict(),
    execute: async ({ names }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/assets`);
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names }),
        signal: abortSignal,
      });
      if (!res.ok) {
        return `Error: unregister_assets failed (HTTP ${res.status})`;
      }
      const json = (await res.json()) as { ok: true; deleted: number };
      return `Unregistered ${json.deleted} asset${json.deleted === 1 ? '' : 's'}.`;
    },
  });
}
