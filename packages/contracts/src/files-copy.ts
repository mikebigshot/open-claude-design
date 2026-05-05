import { z } from 'zod';

export const FileCopyRequest = z.object({
  sources: z.array(z.string()).min(1).max(50),
  destDir: z.string(),
});
export type FileCopyRequest = z.infer<typeof FileCopyRequest>;

export const FileCopyResponse = z.object({
  ok: z.literal(true),
  copied: z.array(z.object({ from: z.string(), to: z.string() })),
});
export type FileCopyResponse = z.infer<typeof FileCopyResponse>;
