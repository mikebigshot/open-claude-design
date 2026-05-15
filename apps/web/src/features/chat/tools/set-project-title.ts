// set_project_title — rename the current project. Thin wrapper around
// PATCH /api/projects/:id with `{name}`. Returns a confirmation string.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function setProjectTitleTool(projectId: string) {
  return tool({
    description:
      "Rename the current project (updates the title shown in the user's project list and the header). Use when the user explicitly asks to rename, or when an initial \"untitled\" project takes shape and a meaningful name would help them find it later.",
    inputSchema: z
      .object({
        title: z.string().min(1).max(120).describe('New project title.'),
      })
      .strict(),
    execute: async ({ title }, { abortSignal }) => {
      const trimmed = title.trim();
      if (!trimmed) return 'Error: title is required.';
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}`);
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
        signal: abortSignal,
      });
      if (!res.ok) {
        return `Error: set_project_title failed (HTTP ${res.status})`;
      }
      return `Renamed project to "${trimmed}".`;
    },
  });
}
