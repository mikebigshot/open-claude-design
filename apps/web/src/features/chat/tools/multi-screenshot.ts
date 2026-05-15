// multi_screenshot — verifier-only. Run a sequence of (code, delay) steps in
// the preview iframe; capture a screenshot after each one, write each frame
// to `_screenshots/<uuid>.png` so the agent gets a stable project-relative
// file reference (not a one-shot data URL).
//
// Returns `JSON.stringify(refs)` — a bare array of `{__image_ref:true, path}`
// objects, NOT wrapped in `{__image_refs:[]}`. The image-ref dispatcher walks
// tool_result content recursively and resolves each `__image_ref` to an
// inline image part on next turn.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';
import { requestFromIframe } from './iframe-bridge.js';

const MULTI_SCREENSHOT_DESCRIPTION = `Take multiple screenshots of the current preview (via html-to-image), running a JS snippet before each capture. Useful for screenshotting different states (e.g. different slides, UI states, scroll positions). Max 12 steps per call. Each frame is persisted to _screenshots/<uuid>.png so subsequent tool calls (view_image, register_assets) can resolve the reference.`;

const MAX_STEPS = 12;

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

export interface MultiScreenshotContext {
  getChatId: () => string;
}

const StepSchema = z.object({
  code: z.string().describe('JavaScript to execute in the preview before capturing'),
  delay: z
    .number()
    .optional()
    .describe('Milliseconds to wait after running the code before capturing. Default: 200'),
});

/** Decode a `data:<mime>;base64,<body>` URL. Returns `null` on malformed input. */
function decodeDataUrl(
  dataUrl: string,
): { bytes: Uint8Array; mimeType: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
  if (!m) return null;
  const mimeType = m[1]!;
  const body = m[2]!;
  try {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

/** Generate a screenshot file path. UUIDv4 ensures uniqueness; the
 *  `_screenshots/` prefix carves out a namespace the user agent and project
 *  view-tools can recognize as "agent-emitted preview frame". */
function makeScreenshotPath(): string {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `_screenshots/${uuid}.png`;
}

export function multiScreenshotTool(projectId: string, ctx: MultiScreenshotContext) {
  return tool({
    description: MULTI_SCREENSHOT_DESCRIPTION,
    inputSchema: z.object({
      path: z.string().describe('The path of the HTML file currently shown in the preview'),
      steps: z.array(StepSchema).describe('Array of capture steps'),
    }),
    execute: async ({ path, steps }, { abortSignal }) => {
      if (steps.length > MAX_STEPS) {
        return `Error: multi_screenshot supports at most ${MAX_STEPS} steps (got ${steps.length}).`;
      }
      const chatId = ctx.getChatId();
      const refs: Array<{ __image_ref: true; path: string }> = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        try {
          const evalResult = await requestFromIframe<EvalJsResponse>({
            chatId,
            viewport: 'agent',
            type: 'AGENT_EVAL_JS',
            payload: { code: step.code },
            timeoutMs: 10_000,
            signal: abortSignal,
          });
          if (!evalResult.ok) {
            return `Error: step ${i + 1} eval failed: ${evalResult.error ?? 'unknown'}`;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error';
          return `Error: step ${i + 1} eval threw: ${msg}`;
        }

        const delayMs = step.delay ?? 200;
        if (delayMs > 0) {
          await new Promise<void>((res) => setTimeout(res, Math.min(delayMs, 60_000)));
        }

        let dataUrl: string;
        try {
          const shotResult = await requestFromIframe<ScreenshotResponse>({
            chatId,
            viewport: 'agent',
            type: 'AGENT_SCREENSHOT',
            payload: { path },
            timeoutMs: 30_000,
            signal: abortSignal,
          });
          if (!shotResult.ok) {
            return `Error: step ${i + 1} screenshot failed: ${shotResult.error ?? 'unknown'}`;
          }
          if (!shotResult.dataUrl) {
            return `Error: step ${i + 1} screenshot returned without dataUrl`;
          }
          dataUrl = shotResult.dataUrl;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error';
          return `Error: step ${i + 1} screenshot threw: ${msg}`;
        }

        // Decode data URL → bytes, PUT to _screenshots/<uuid>.png. The agent
        // gets a stable path that view_image / register_assets / next-turn
        // image-ref dispatcher can all resolve. If PUT fails for whatever
        // reason (network, 5xx) the path still routes to the persisted file
        // via the normal /files/<path> GET — we surface the error so the
        // agent can retry that frame.
        const decoded = decodeDataUrl(dataUrl);
        if (!decoded) {
          return `Error: step ${i + 1} screenshot dataUrl is not a base64 data URL.`;
        }
        const filePath = makeScreenshotPath();
        const putUrl = buildUrl(
          `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(filePath)}`,
        );
        // Wrap into a fresh ArrayBuffer to satisfy fetch BodyInit typing.
        const body = new Uint8Array(decoded.bytes).buffer;
        let writeRes: Response;
        try {
          writeRes = await fetch(putUrl, {
            method: 'PUT',
            body,
            headers: { 'content-type': decoded.mimeType },
            signal: abortSignal,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error';
          return `Error: step ${i + 1} screenshot write threw: ${msg}`;
        }
        if (!writeRes.ok) {
          return `Error: step ${i + 1} screenshot write failed (HTTP ${writeRes.status}).`;
        }
        refs.push({ __image_ref: true, path: filePath });
      }
      return JSON.stringify(refs);
    },
  });
}
