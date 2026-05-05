import { tool } from 'ai';
import { z } from 'zod';

export function doneTool() {
  return tool({
    description:
      "Surface the file to the user. Call this when you've finished a coherent unit of work (a screen, a page, an iteration). Pass a one-line `summary` describing what's been built.",
    inputSchema: z.object({
      summary: z.string().optional().describe('One-line summary of what was built.'),
    }),
    execute: async ({ summary }) => ({ ok: true as const, message: summary ?? '' }),
  });
}
