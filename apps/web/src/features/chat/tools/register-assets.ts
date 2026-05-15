// register_assets — register one or more files in the asset review manifest.
// Each `(asset, path)` pair becomes a row in the project's `assets` table; re-
// registering resets status to 'needs-review'.
//
// Source: artifacts/tools/tools-full-schema.json (register_assets entry).
//   - input_schema: { items: AssetRegistration[] }
//   - per-item required: { asset, path }
//   - tag each item with `group` to split cards by section in the Design
//     System tab — preferred values: "Type" / "Colors" / "Spacing" /
//     "Components" / "Brand"

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

const REGISTER_ASSETS_DESCRIPTION = `Register one or more files in the asset review manifest. Each file becomes a version of the named asset. Re-registering an existing (asset, path) pair resets its review status. Tag each item with a \`group\` so the Design System tab can split cards into sections — prefer one of: "Type", "Colors", "Spacing", "Components", "Brand".`;

const AssetItemSchema = z.object({
  path: z.string().describe('File path relative to project root'),
  asset: z.string().describe('Asset name to register this file under'),
  subtitle: z.string().optional().describe('Short description of this version'),
  viewport: z
    .object({
      width: z.number().describe('Design width in px'),
      height: z.number().optional().describe('Intended height cap in px'),
    })
    .optional(),
  status: z
    .enum(['needs-review', 'approved', 'changes-requested'])
    .optional()
    .describe('Review status'),
  group: z
    .string()
    .optional()
    .describe(
      'Section this card belongs to in the Design System tab. Prefer "Type" for typography cards, "Colors" for palettes and scales, "Spacing" for radii/shadows/spacing tokens, "Components" for buttons/forms/cards/badges, "Brand" for logos/imagery/anything else. Title-cased. Omit only if truly unclassifiable.',
    ),
});

export function registerAssetsTool(projectId: string) {
  return tool({
    description: REGISTER_ASSETS_DESCRIPTION,
    inputSchema: z.object({
      items: z.array(AssetItemSchema).describe('Assets to register'),
    }),
    execute: async ({ items }, { abortSignal }) => {
      try {
        const res = await fetch(buildUrl(`/api/projects/${encodeURIComponent(projectId)}/assets`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items }),
          signal: abortSignal,
        });
        if (!res.ok) {
          return `Error: register_assets failed with status ${res.status}`;
        }
        const json = (await res.json()) as { registered: Array<unknown> };
        const count = Array.isArray(json.registered) ? json.registered.length : 0;
        return `Registered ${count} asset(s).`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: register_assets failed (${msg})`;
      }
    },
  });
}
