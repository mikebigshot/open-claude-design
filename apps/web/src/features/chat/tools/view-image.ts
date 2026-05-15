import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

type ViewImageInput = { path: string };
type ViewImageOutput =
  | { ok: false; error: 'not_found' }
  | { ok: true; content: { type: 'image'; mediaType: string; data: string }[] };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function viewImageTool(projectId: string) {
  return tool<ViewImageInput, ViewImageOutput>({
    description:
      'Read an image file in the project so you can see its contents in the next turn. Use for screenshots / mockups / reference images.',
    inputSchema: z.object({ path: z.string().describe('Image file path.') }),
    execute: async ({ path }, { abortSignal }) => {
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
      );
      const res = await fetch(url, { signal: abortSignal });
      if (res.status === 404) return { ok: false as const, error: 'not_found' as const };
      if (!res.ok) throw new Error(`view_image failed: ${res.status}`);
      const mediaType = res.headers.get('content-type') ?? 'application/octet-stream';
      const buf = new Uint8Array(await res.arrayBuffer());
      const data = bytesToBase64(buf);
      return {
        ok: true as const,
        content: [{ type: 'image' as const, mediaType, data }],
      };
    },
    // Emit proper SDK image-data content so the LLM sees the image visually,
    // not a JSON blob with a base64 string.
    toModelOutput: ({ output }) => {
      const o = output as
        | { ok: false; error: string }
        | { ok: true; content: { type: 'image'; mediaType: string; data: string }[] };
      if (!o.ok) {
        return { type: 'json', value: o as never };
      }
      return {
        type: 'content',
        value: o.content.map((part) => ({
          type: 'image-data' as const,
          data: part.data,
          mediaType: part.mediaType,
        })),
      };
    },
  });
}
