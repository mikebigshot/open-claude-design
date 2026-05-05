import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function webFetchTool() {
  return tool({
    description:
      'Fetch a URL and return extracted text (no HTML, no layout). Use for "design like this site" research. For visual reference, ask the user for a screenshot instead — text alone loses layout cues.',
    inputSchema: z.object({ url: z.string().url().describe('http(s) URL.') }),
    execute: async ({ url }, { abortSignal }) => {
      const res = await fetch(buildUrl(`/api/util/fetch?url=${encodeURIComponent(url)}`), {
        signal: abortSignal,
      });
      if (!res.ok) throw new Error(`web_fetch failed: ${res.status}`);
      const json = (await res.json()) as
        | { ok: true; title: string; text: string }
        | { ok: false; error: string };
      return json;
    },
  });
}
