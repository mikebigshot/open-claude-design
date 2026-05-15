// set_project_title — rename the current project, but only when the existing
// name is a placeholder (matches claude.ai/design bundle Bu8zJzmd guard).
//
// Flow: GET /api/projects/:id to read current name → if it's not in the
// placeholder set ("" or "Design System") return the no-op string → otherwise
// PATCH /api/projects/:id with {name:trimmed}.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

const PLACEHOLDER_NAMES = new Set(['', 'Design System']);

export function setProjectTitleTool(projectId: string) {
  return tool({
    description:
      'Rename the current project (updates the title shown in the project list and the header). No-op when the user has already given it a non-placeholder name — use once you have identified a brand or product name so the project is findable in the picker.',
    inputSchema: z
      .object({
        title: z.string().min(1).max(120).describe('New project title.'),
      })
      .strict(),
    execute: async ({ title }, { abortSignal }) => {
      const trimmed = title.trim();
      if (!trimmed) return 'Error: title is required.';
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}`);

      const getRes = await fetch(url, { signal: abortSignal });
      if (!getRes.ok) {
        return `Error: set_project_title failed to read current name (HTTP ${getRes.status})`;
      }
      const project = (await getRes.json()) as { name?: string };
      const currentName = (project.name ?? '').trim();
      if (!PLACEHOLDER_NAMES.has(currentName)) {
        return `Project already named "${currentName}" — leaving as-is.`;
      }

      const patchRes = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
        signal: abortSignal,
      });
      if (!patchRes.ok) {
        return `Error: set_project_title failed (HTTP ${patchRes.status})`;
      }
      return `Renamed project to "${trimmed}".`;
    },
  });
}
