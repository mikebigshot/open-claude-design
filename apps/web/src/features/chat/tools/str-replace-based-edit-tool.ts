// str_replace_based_edit_tool — atomic edit via single RPC.
//
// Was client-side GET + replace + PUT (non-atomic, race-prone under
// concurrent writes). Now POSTs `{path, edits}` to a worker endpoint that
// performs the whole get-modify-put inside a single D1 transaction, so
// uniqueness validation and the version bump are consistent.
//
// `edits[]` lets the tool batch multiple replacements in one atomic step.
// The single-edit shorthand `{old_string, new_string}` is normalized into
// `edits: [{...}]` before sending.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

const EditEntry = z.object({
  old_string: z.string().min(1).describe('Substring to find. Must be unique within the file at the time of edit.'),
  new_string: z.string().describe('Replacement text.'),
});

function dispatchFileWritten(path: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('file-written', { detail: { path } }));
}

interface EditResponse {
  ok: true;
  path: string;
  sha256: string;
  size: number;
  editsApplied: number;
}

interface EditError {
  error: string;
  count?: number;
  editIndex?: number;
}

export function strReplaceBasedEditTool(projectId: string) {
  return tool({
    description:
      'Replace one or more unique substrings in an existing file. Each `old_string` must match exactly once at edit time. Provide a single edit via `{old_string, new_string}` shorthand or batch via `edits: [...]`. Cheaper than re-emitting a whole file with `write_file`.',
    inputSchema: z
      .object({
        path: z.string().min(1).describe('File path relative to project root.'),
        old_string: z.string().optional().describe('(Shorthand) substring to find.'),
        new_string: z.string().optional().describe('(Shorthand) replacement text.'),
        edits: z.array(EditEntry).optional().describe('Batch of edits to apply atomically.'),
      })
      .strict()
      .refine(
        (v) =>
          Array.isArray(v.edits) && v.edits.length > 0
            ? v.old_string === undefined && v.new_string === undefined
            : typeof v.old_string === 'string' && typeof v.new_string === 'string',
        {
          message: 'Provide either {old_string, new_string} or a non-empty `edits` array.',
        },
      ),
    execute: async ({ path, old_string, new_string, edits }, { abortSignal }) => {
      const normalized =
        edits && edits.length > 0
          ? edits
          : [{ old_string: old_string ?? '', new_string: new_string ?? '' }];

      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files-edit`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, edits: normalized }),
        signal: abortSignal,
      });

      if (!res.ok) {
        let err: EditError | undefined;
        try {
          err = (await res.json()) as EditError;
        } catch {
          /* not JSON */
        }
        if (err?.error === 'multiple_matches') {
          return `Error: str_replace failed at edit ${err.editIndex ?? 0}: old_string matches ${err.count ?? 'multiple'} times. Make it more specific.`;
        }
        if (err?.error === 'not_found') {
          return `Error: str_replace failed (404 not_found) — no file at ${path}, or edit ${err.editIndex ?? 0}'s old_string did not match.`;
        }
        return `Error: str_replace failed (HTTP ${res.status}${err?.error ? ` ${err.error}` : ''})`;
      }

      const json = (await res.json()) as EditResponse;
      dispatchFileWritten(path);
      const count = json.editsApplied ?? normalized.length;
      return `Applied ${count} edit${count === 1 ? '' : 's'} to ${path}`;
    },
  });
}
