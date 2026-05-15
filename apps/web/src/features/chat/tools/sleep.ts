// sleep — pause execution for a short interval before the next step.
//
//   - clamp seconds to [0, 60]
//   - AbortSignal-aware (resolves promptly when the agent loop is cancelled)
//   - returns a short confirmation string

import { tool } from 'ai';
import { z } from 'zod';

const MIN_SECONDS = 0;
const MAX_SECONDS = 60;

function clamp(n: number): number {
  if (Number.isNaN(n)) return MIN_SECONDS;
  return Math.min(Math.max(n, MIN_SECONDS), MAX_SECONDS);
}

export function sleepTool() {
  return tool({
    description:
      'Sleep / wait for `seconds` before the next step. Useful after triggering a slow render or animation. Clamped to [0, 60] seconds.',
    inputSchema: z.object({
      seconds: z.number().describe('How long to sleep, in seconds (0-60).'),
    }),
    execute: async ({ seconds }, { abortSignal }) => {
      const dur = clamp(Number(seconds));
      if (dur === 0) return 'Slept 0s.';

      const aborted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
          resolve(false);
        }, dur * 1000);
        const onAbort = (): void => {
          clearTimeout(timer);
          resolve(true);
        };
        if (abortSignal?.aborted) {
          clearTimeout(timer);
          resolve(true);
          return;
        }
        abortSignal?.addEventListener('abort', onAbort, { once: true });
      });

      return aborted ? `Sleep aborted after AbortSignal fired.` : `Slept ${dur}s.`;
    },
  });
}
