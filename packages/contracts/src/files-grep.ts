import { z } from 'zod';

export const FileGrepRequest = z.object({
  pattern: z.string().min(1).max(500),
  include: z.string().optional(),
});
export type FileGrepRequest = z.infer<typeof FileGrepRequest>;

export const FileGrepResponse = z.object({
  ok: z.literal(true),
  matches: z.array(z.object({ path: z.string(), line: z.number().int(), text: z.string() })),
  truncated: z.boolean(),
});
export type FileGrepResponse = z.infer<typeof FileGrepResponse>;
