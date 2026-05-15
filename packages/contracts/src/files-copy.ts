import { z } from 'zod';

// File copy — per-file `[{src, dest, move?, asset?}]` batch.
// Was a flat `{sources, destDir}` shared-destDir API.
//   - `move: true` removes the src row after copy (rename semantics).
//   - `asset` is reserved for assets-manifest registration in a future phase.
// Reuses sha256 across copies so the underlying blob is not re-uploaded.

export const FileCopyEntry = z.object({
  src: z.string().min(1),
  dest: z.string().min(1),
  move: z.boolean().optional(),
  asset: z.string().optional(),
});
export type FileCopyEntry = z.infer<typeof FileCopyEntry>;

export const FileCopyRequest = z.object({
  files: z.array(FileCopyEntry).min(1).max(50),
});
export type FileCopyRequest = z.infer<typeof FileCopyRequest>;

export const FileCopyResultEntry = z.object({
  src: z.string(),
  dest: z.string(),
  moved: z.boolean(),
});
export type FileCopyResultEntry = z.infer<typeof FileCopyResultEntry>;

export const FileCopyResponse = z.object({
  ok: z.literal(true),
  results: z.array(FileCopyResultEntry),
});
export type FileCopyResponse = z.infer<typeof FileCopyResponse>;
