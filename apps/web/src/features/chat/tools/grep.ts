// grep — regex search across project text files.
//   - pattern is a JS regex (case-insensitive by default — no flag needed)
//   - `path` scope: dir prefix searches all files under it; a file path
//     searches only that file
//   - returns up to 100 matches with ±2 lines context per hit, formatted
//     for the LLM as a readable string (path:line + before/match/after)

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

interface GrepMatch {
  path: string;
  line: number;
  before: string[];
  match: string;
  after: string[];
}

interface GrepResponse {
  ok: true;
  matches: GrepMatch[];
  truncated: boolean;
}

const DESCRIPTION =
  'Search file contents for a regex pattern (JS RegExp syntax — case-insensitive by default). Returns each match with its file path, line number, and ±2 lines of surrounding context. Returns up to 100 matches — if you hit the cap, narrow the pattern or scope with `path` to drill in.';

function formatLine(n: number, text: string, marker: string): string {
  return `${marker} ${String(n).padStart(4, ' ')} | ${text}`;
}

function formatMatch(m: GrepMatch): string {
  const out: string[] = [`${m.path}:${m.line}`];
  const startLine = m.line - m.before.length;
  m.before.forEach((b, i) => out.push(formatLine(startLine + i, b, ' ')));
  out.push(formatLine(m.line, m.match, '>'));
  m.after.forEach((a, i) => out.push(formatLine(m.line + 1 + i, a, ' ')));
  return out.join('\n');
}

function formatResponse(json: GrepResponse): string {
  if (json.matches.length === 0) return '(no matches)';
  const header = `${json.matches.length} match(es)${json.truncated ? ' (truncated — narrow your pattern or pass `path`)' : ''}`;
  return `${header}\n\n${json.matches.map(formatMatch).join('\n\n')}`;
}

export function grepTool(projectId: string) {
  return tool({
    description: DESCRIPTION,
    inputSchema: z
      .object({
        pattern: z.string().min(1).describe('Regex pattern to search for (JS RegExp).'),
        path: z
          .string()
          .optional()
          .describe(
            'Limit search scope: a directory path searches everything under it; a file path searches just that file. Omit to search the whole project.',
          ),
      })
      .strict(),
    execute: async ({ pattern, path }, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/grep`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pattern, ...(path ? { path } : {}) }),
        signal: abortSignal,
      });
      if (!res.ok) {
        return `Error: grep failed (HTTP ${res.status})`;
      }
      const json = (await res.json()) as GrepResponse;
      return formatResponse(json);
    },
  });
}
