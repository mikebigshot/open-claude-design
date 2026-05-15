// save_as_template — snapshot the current project as a reusable template
// so the user can spin up new projects starting from this design. Reuses
// the underlying R2 blobs by sha256 — only the file-list metadata is
// duplicated into the templates D1 tables. Templates surface in the Home
// page's "From template" tab.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function saveAsTemplateTool(projectId: string) {
  return tool({
    description:
      "Save the current project's current state as a reusable template. New projects can later be started from this template (see the Home page's \"From template\" tab). Pass a short `name` and an optional `description` summarizing what's inside.",
    inputSchema: z
      .object({
        name: z.string().min(1).max(120).describe('Template name shown in the picker.'),
        description: z
          .string()
          .max(500)
          .optional()
          .describe('Optional one-line summary.'),
      })
      .strict(),
    execute: async ({ name, description }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/save-as-template`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, ...(description ? { description } : {}) }),
        signal: abortSignal,
      });
      if (!res.ok) {
        if (res.status === 400) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          return `Error: save_as_template failed (${body.error ?? 'bad_request'})`;
        }
        return `Error: save_as_template failed (HTTP ${res.status})`;
      }
      const body = (await res.json()) as { templateId: string; fileCount: number };
      return `Saved as template "${name}" — id=${body.templateId} (${body.fileCount} files snapshotted).`;
    },
  });
}
