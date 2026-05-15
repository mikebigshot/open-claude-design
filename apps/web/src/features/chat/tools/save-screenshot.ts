// save_screenshot — capture one or more screenshots from the user's preview
// pane and either (a) save them as PNGs in the project filesystem under
// `save_path`, or (b) stash them as a PNG-blob array on `window.__captures`
// for in-memory consumption by `run_script` via getCaptures(). Mirrors the
// official tool's two-mode contract: provide exactly one of `save_path` or
// `in_memory_png_key`.
//
// Each step runs a JS snippet in the preview (via AGENT_EVAL_JS) + waits
// `delay` ms (default 200) + captures via AGENT_SCREENSHOT. Max 100 steps.
//
// Disk mode: multi-step captures get a 2-digit prefix
// ("01-name.png", "02-name.png"); single step uses save_path verbatim.
// In-memory mode: window.__captures[key] = Array<Blob>; same array slot
// shared with run_script's `getCaptures`.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';
import { setScreenshotCaptures } from '../lib/screenshot-pool.js';
import { requestFromIframe } from './iframe-bridge.js';

const MAX_STEPS = 100;

const StepSchema = z.object({
  code: z.string().optional().describe('Optional JS to run in the preview before capturing.'),
  delay: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Milliseconds to wait after running code before capturing. Default: 200.'),
});

interface EvalJsResponse {
  type: 'AGENT_EVAL_JS_RESULT';
  requestId: string;
  ok: boolean;
  value?: string;
  error?: string;
}

interface ScreenshotResponse {
  type: 'AGENT_SCREENSHOT_RESULT';
  requestId: string;
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface SaveScreenshotContext {
  getChatId: () => string;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',', 2);
  const mime = meta?.match(/data:([^;]+)/)?.[1] ?? 'image/png';
  const binary = atob(b64 ?? '');
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr.buffer as ArrayBuffer], { type: mime });
}

function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

function deriveDiskPaths(savePath: string, count: number): string[] {
  if (count <= 1) return [savePath];
  // Split into dir + filename
  const lastSlash = savePath.lastIndexOf('/');
  const dir = lastSlash >= 0 ? savePath.slice(0, lastSlash + 1) : '';
  const file = lastSlash >= 0 ? savePath.slice(lastSlash + 1) : savePath;
  return Array.from({ length: count }, (_, i) => {
    const prefix = String(i + 1).padStart(2, '0');
    return `${dir}${prefix}-${file}`;
  });
}

export function saveScreenshotTool(projectId: string, ctx: SaveScreenshotContext) {
  return tool({
    description:
      'Take one or more screenshots of the preview pane and save them — either to the project filesystem (save_path) or in memory for use in run_script (in_memory_png_key). Each step optionally runs JS, waits, then captures. Up to 100 steps. Use view_image after a disk save if you need to see the result.',
    inputSchema: z
      .object({
        steps: z
          .array(StepSchema)
          .min(1)
          .max(MAX_STEPS)
          .describe('Array of capture steps. Single step with empty {} for a one-shot capture.'),
        save_path: z
          .string()
          .optional()
          .describe(
            'Project-relative path. Multi-step captures get a 2-digit prefix. Mutually exclusive with in_memory_png_key.',
          ),
        in_memory_png_key: z
          .string()
          .optional()
          .describe(
            'Key for window.__captures pool. Used by run_script via getCaptures(key).',
          ),
      })
      .strict()
      .refine(
        (v) =>
          (typeof v.save_path === 'string') !== (typeof v.in_memory_png_key === 'string'),
        {
          message: 'Provide exactly one of save_path / in_memory_png_key.',
        },
      ),
    execute: async ({ steps, save_path, in_memory_png_key }, { abortSignal }) => {
      const chatId = ctx.getChatId();
      const captures: string[] = []; // collected dataUrls in step order

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        if (step.code) {
          try {
            const ev = await requestFromIframe<EvalJsResponse>({
              chatId,
              viewport: 'user',
              type: 'AGENT_EVAL_JS',
              payload: { code: step.code },
              timeoutMs: 10_000,
              signal: abortSignal,
            });
            if (!ev.ok) {
              return `Error: step ${i + 1} eval failed: ${ev.error ?? 'unknown'}`;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown error';
            return `Error: step ${i + 1} eval threw: ${msg}`;
          }
        }
        const delayMs = step.delay ?? 200;
        if (delayMs > 0) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(delayMs, 60_000)),
          );
        }
        try {
          const shot = await requestFromIframe<ScreenshotResponse>({
            chatId,
            viewport: 'user',
            type: 'AGENT_SCREENSHOT',
            timeoutMs: 30_000,
            signal: abortSignal,
          });
          if (!shot.ok || !shot.dataUrl) {
            return `Error: step ${i + 1} screenshot failed: ${shot.error ?? 'no dataUrl'}`;
          }
          captures.push(shot.dataUrl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error';
          return `Error: step ${i + 1} screenshot threw: ${msg}`;
        }
      }

      // In-memory mode → stash on the canonical screenshot-pool (shared
      // with view_image / register_assets / any future reader) AND on
      // window.__captures as a back-compat alias for run_script's
      // getCaptures() helper.
      if (in_memory_png_key !== undefined) {
        const blobs = captures.map(dataUrlToBlob);
        setScreenshotCaptures(in_memory_png_key, blobs);
        if (typeof window !== 'undefined') {
          const w = window as unknown as { __captures?: Record<string, Blob[]> };
          w.__captures = w.__captures ?? {};
          w.__captures[in_memory_png_key] = blobs;
        }
        return `Saved ${captures.length} screenshot${captures.length === 1 ? '' : 's'} to in-memory pool under key "${in_memory_png_key}". Use getCaptures("${in_memory_png_key}") inside run_script, or reference them in view_image via "__pool:${in_memory_png_key}:<index>".`;
      }

      // Disk mode → PUT each capture as a project file.
      const paths = deriveDiskPaths(save_path!, captures.length);
      for (let i = 0; i < captures.length; i++) {
        const data = dataUrlToBase64(captures[i]!);
        const path = paths[i]!;
        const url = buildUrl(
          `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
        );
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)),
          signal: abortSignal,
        });
        if (!res.ok) {
          return `Error: step ${i + 1} save to "${path}" failed (HTTP ${res.status})`;
        }
      }
      return `Saved ${captures.length} screenshot${captures.length === 1 ? '' : 's'} to ${paths.join(', ')}.`;
    },
  });
}
