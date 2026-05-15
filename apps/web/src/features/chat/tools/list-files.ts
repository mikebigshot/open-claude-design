// list_files — directory-aware listing built on top of the worker's flat
// file list. Walks the flat path set to synthesize directory entries at the
// requested `path` + `depth`, applies an optional regex `filter`, supports
// `offset` pagination, and caps output at 200 entries per call (matches
// the official tool's spec).

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';
import { resolveCrossProjectPath } from '../lib/cross-project-path.js';

const MAX_ENTRIES = 200;
const DEFAULT_DEPTH = 1;

const DESCRIPTION =
  'List files and directories in a folder. Returns up to 200 results per call. If there are more, the output reports the total count and how to paginate. Use `path` to scope into a subdirectory, `depth` (default 1) to peek deeper, `offset` for pagination, and `filter` (regex) to narrow results.';

interface WorkerListResponse {
  files: Array<{ path: string }>;
}

interface Entry {
  name: string;
  type: 'file' | 'directory';
}

function normalizePrefix(p: string): string {
  if (!p) return '';
  return p.endsWith('/') ? p : p + '/';
}

export function walkEntries(
  allPaths: readonly string[],
  scopePath: string,
  depth: number,
  filter?: string,
): Entry[] {
  const prefix = normalizePrefix(scopePath);
  const re = filter ? new RegExp(filter) : null;
  // Map<name, type> — first sighting wins so children don't downgrade a
  // directory's type once seen.
  const seen = new Map<string, 'file' | 'directory'>();
  for (const fpath of allPaths) {
    if (!fpath.startsWith(prefix)) continue;
    const rest = fpath.slice(prefix.length);
    if (!rest) continue;
    const parts = rest.split('/');
    // For each level up to `depth`, materialize an entry.
    for (let d = 0; d < Math.min(depth, parts.length); d += 1) {
      const name = parts.slice(0, d + 1).join('/');
      const isLeaf = d === parts.length - 1;
      const type = isLeaf ? 'file' : 'directory';
      const existing = seen.get(name);
      if (existing === 'directory') continue; // already pinned as dir
      if (!existing) {
        seen.set(name, type);
      } else if (type === 'directory') {
        seen.set(name, 'directory');
      }
    }
  }
  const out: Entry[] = [];
  for (const [name, type] of seen) {
    if (re && !re.test(name)) continue;
    out.push({ name, type });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function renderEntries(
  entries: Entry[],
  offset: number,
  total: number,
): string {
  if (entries.length === 0 && total === 0) return '(empty directory)';
  const lines = entries.map((e) => `${e.type === 'directory' ? '📁' : '📄'} ${e.name}`);
  const visibleCount = entries.length;
  const showing = offset + visibleCount;
  if (showing < total) {
    lines.push(
      '',
      `[Showing ${visibleCount} of ${total} results. Use offset=${showing} to see more.]`,
    );
  }
  return lines.join('\n');
}

export function listFilesTool(projectId: string) {
  return tool({
    description: DESCRIPTION,
    inputSchema: z
      .object({
        path: z
          .string()
          .optional()
          .describe('Directory path relative to project root. Omit / empty to list root.'),
        depth: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('How many levels deep to show (1 = direct children only). Default: 1.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Skip this many results for pagination. Default: 0.'),
        filter: z
          .string()
          .optional()
          .describe('Regex pattern applied to each entry\'s relative path.'),
      })
      .strict(),
    execute: async ({ path, depth, offset, filter }, { abortSignal }) => {
      // Cross-project syntax: `/projects/<id>/<dir>` routes the list to
      // the target project and scopes the walk to <dir>.
      const ref = resolveCrossProjectPath(projectId, path ?? '');
      const effectivePath = ref.crossProject ? ref.relPath : path ?? '';
      const url = buildUrl(`/api/projects/${encodeURIComponent(ref.projectId)}/files`);
      let res: Response;
      try {
        res = await fetch(url, { method: 'GET', signal: abortSignal });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: list_files fetch failed (${msg})`;
      }
      if (res.status === 404) return `Error: project not found (404).`;
      if (!res.ok) return `Error: list_files failed (HTTP ${res.status} ${res.statusText}).`;

      const json = (await res.json()) as WorkerListResponse;
      const allPaths = (json.files ?? []).map((f) => f.path);

      const all = walkEntries(allPaths, effectivePath, depth ?? DEFAULT_DEPTH, filter);
      const total = all.length;
      const effectiveOffset = offset ?? 0;
      const sliced = all.slice(effectiveOffset, effectiveOffset + MAX_ENTRIES);
      return renderEntries(sliced, effectiveOffset, total);
    },
  });
}
