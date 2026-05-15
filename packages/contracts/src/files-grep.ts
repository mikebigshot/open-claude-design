import { z } from 'zod';

// File grep — aligned with official Claude Design `grep` tool:
//   pattern: regex (JS / RE2-compatible, no backreferences). Case-insensitive
//     by default. 1-500 chars.
//   path:    optional scope — dir prefix (e.g. "src/") or single file path.
//            Replaces the older substring-only `include` parameter.
//   Returns: per match, the matched line plus up to 2 lines of context
//            before and after. Capped at 100 matches.
export const FileGrepRequest = z.object({
  pattern: z.string().min(1).max(500),
  path: z.string().optional(),
});
export type FileGrepRequest = z.infer<typeof FileGrepRequest>;

export const FileGrepMatch = z.object({
  path: z.string(),
  line: z.number().int(),
  before: z.array(z.string()),
  match: z.string(),
  after: z.array(z.string()),
});
export type FileGrepMatch = z.infer<typeof FileGrepMatch>;

export const FileGrepResponse = z.object({
  ok: z.literal(true),
  matches: z.array(FileGrepMatch),
  truncated: z.boolean(),
});
export type FileGrepResponse = z.infer<typeof FileGrepResponse>;
