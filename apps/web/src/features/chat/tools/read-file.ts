// read_file — paginated UTF-8 file reader with size/token guards.
//
// Constants:
//   DEFAULT_LIMIT      = 2000    — default line limit
//   LINE_TRUNCATE_AT   = 2000    — per-line truncation cap (chars)
//   SIZE_GUARD_BYTES   = 256KB   — full-file size guard (only enforced when no offset/limit)
//   TOKEN_GUARD        = 25000   — token guard (computed as chars/4)
//
// Pagination contract: offset is 0-indexed, default limit 2000. Output is a
// formatted string for the LLM with [File: <path>] header, total/showing line
// info, and the content. Errors come back as strings (never throw) so the
// agent can recover.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';
import { resolveCrossProjectPath } from '../lib/cross-project-path.js';

const DEFAULT_LIMIT = 2000;
const LINE_TRUNCATE_AT = 2000;
const SIZE_GUARD_BYTES = 256 * 1024;
const TOKEN_GUARD = 25_000;

const DESCRIPTION =
  'Read the contents of a file. Returns up to 2000 lines by default; use offset/limit to paginate.';

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateLine(line: string): string {
  if (line.length <= LINE_TRUNCATE_AT) return line;
  return `${line.slice(0, LINE_TRUNCATE_AT)}…[line truncated, ${line.length} chars total]`;
}

function formatOutput(
  path: string,
  fullText: string,
  offset: number,
  limit: number,
): string | { errorMessage: string } {
  const totalLines = fullText.split('\n');
  const totalCount = totalLines.length;
  const slice = totalLines.slice(offset, offset + limit);
  const endIndex = offset + slice.length;

  const truncated = slice.map(truncateLine);
  const body = truncated.join('\n');

  if (approxTokens(body) > TOKEN_GUARD) {
    return {
      errorMessage: `Error: File content (${approxTokens(body)} tokens) exceeds maximum allowed tokens (${TOKEN_GUARD}). Use offset and limit parameters to read specific portions of the file, or use grep to search for specific content instead of reading the whole file.`,
    };
  }

  let header = `[File: ${path}]\n`;
  if (offset === 0 && endIndex >= totalCount) {
    header += `[${totalCount} lines, ${fullText.length} chars — showing all]\n\n`;
  } else {
    header += `[${totalCount} lines total — showing lines ${offset + 1}-${endIndex}. Use offset=${endIndex} to continue.]\n\n`;
  }
  return header + body;
}

export function readFileTool(projectId: string) {
  return tool({
    description: DESCRIPTION,
    inputSchema: z
      .object({
        path: z.string().min(1).describe('File path relative to project root.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Line offset to start reading from (0-indexed). Default: 0.'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(`Max lines to return. Default: ${DEFAULT_LIMIT}.`),
      })
      .strict(),
    execute: async ({ path, offset, limit }, { abortSignal }) => {
      const ref = resolveCrossProjectPath(projectId, path);
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(ref.projectId)}/files/${encodeURI(ref.relPath)}`,
      );
      let res: Response;
      try {
        res = await fetch(url, { method: 'GET', signal: abortSignal });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return `Error: read_file fetch failed (${msg})`;
      }
      if (res.status === 404) {
        return `Error: file not found (404) at path: ${path}`;
      }
      if (!res.ok) {
        return `Error: read_file failed (HTTP ${res.status} ${res.statusText})`;
      }
      const content = await res.text();

      // 256KB guard: only when caller did NOT pass offset or limit. Once the
      // caller is paginating, they've opted into reading a slice.
      const usingPagination = offset !== undefined || limit !== undefined;
      if (!usingPagination && content.length > SIZE_GUARD_BYTES) {
        return `Error: File content (${content.length}) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file, or use grep to search for specific content instead of reading the whole file.`;
      }

      const effectiveOffset = offset ?? 0;
      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      const formatted = formatOutput(path, content, effectiveOffset, effectiveLimit);
      if (typeof formatted === 'object') return formatted.errorMessage;
      return formatted;
    },
  });
}
