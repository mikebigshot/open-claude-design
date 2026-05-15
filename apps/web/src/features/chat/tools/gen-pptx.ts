// gen_pptx — convert a structured deck description into an editable
// PowerPoint file via pptxgenjs and trigger a browser download.
//
// We don't try to parse the agent's rendered HTML — instead the agent feeds
// us slides[] with semantic fields (title / bullets / images / shapes /
// notes). pptxgenjs then emits native PowerPoint text boxes, shapes and
// images — fully editable in PowerPoint / Keynote / Google Slides.
//
// 'screenshots' mode (Step G) ships in the same tool via a different code
// path; this file lands the 'editable' branch first.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';
import { getScreenshotCapture } from '../lib/screenshot-pool.js';

// pptxgenjs is CommonJS — use a runtime import inside the lazy factory so
// tests can DI a fake without pulling the real ~750 KB module.
type PptxLike = {
  defineLayout(spec: { name?: string; width: number; height: number }): void;
  layout: string;
  title?: string;
  subject?: string;
  addSlide(): SlideLike;
  write(opts?: { outputType?: 'blob' | 'arraybuffer' | 'base64' }): Promise<Blob | Uint8Array | string>;
};
type SlideLike = {
  addText(text: string | unknown[], opts: Record<string, unknown>): SlideLike;
  addImage(opts: Record<string, unknown>): SlideLike;
  addShape(shape: unknown, opts: Record<string, unknown>): SlideLike;
  addNotes?(v: string): void;
  notes: string;
};

export interface GenPptxDeps {
  /**
   * Returns a fresh pptxgenjs PPTX instance. Defaults to lazily importing
   * the real module via `await import('pptxgenjs')`. Typed loose (`unknown`)
   * so tests can pass a fake without conforming to the full pptxgenjs
   * surface — the implementation casts internally.
   */
  pptxFactory?: () => Promise<unknown> | unknown;
  triggerDownload?: (blob: Blob, filename: string) => void;
}

const SlideSpec = z.object({
  // editable-mode fields
  title: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  shapes: z
    .array(
      z.object({
        kind: z
          .enum(['rect', 'roundRect', 'ellipse', 'line'])
          .describe('pptxgenjs shape kind'),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        fill: z.string().optional(),
        line: z.string().optional(),
      }),
    )
    .optional(),
  images: z
    .array(
      z.object({
        url: z.string().describe('Image URL or data: URI'),
        x: z.number().describe('Inches from slide left'),
        y: z.number().describe('Inches from slide top'),
        w: z.number().describe('Width in inches'),
        h: z.number().describe('Height in inches'),
        alt: z.string().optional(),
      }),
    )
    .optional(),
  // screenshots-mode field — a single full-bleed image per slide (data URI
  // or URL). When set, title/bullets/shapes/images are ignored.
  image: z
    .string()
    .optional()
    .describe('Screenshots-mode: full-slide PNG/JPEG as a data: URI or URL.'),
  notes: z.string().optional(),
});

const InputSchema = z.object({
  mode: z
    .enum(['editable', 'screenshots'])
    .default('editable')
    .describe(
      "'editable' (native shapes/text, default) or 'screenshots' (PNG per slide — Step G).",
    ),
  width: z.number().optional().describe('Slide width in CSS px (default 1920).'),
  height: z.number().optional().describe('Slide height in CSS px (default 1080).'),
  slides: z.array(SlideSpec).describe('Structured slide specs to emit, in order.'),
  outputFilename: z
    .string()
    .optional()
    .describe('Download filename (extension `.pptx` appended if missing).'),
});

type Input = z.infer<typeof InputSchema>;
type Output =
  | { ok: true; mode: 'editable' | 'screenshots'; slideCount: number; bytes: number; filename: string }
  | { ok: false; error: 'invalid_input'; message: string }
  | { ok: false; error: 'unsupported_mode'; message: string }
  | { ok: false; error: 'render_failed'; message: string };

function defaultTriggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function defaultPptxFactory(): Promise<PptxLike> {
  const mod = (await import('pptxgenjs')) as unknown as { default?: new () => PptxLike } | (new () => PptxLike);
  const Ctor = (mod as { default?: new () => PptxLike }).default ?? (mod as new () => PptxLike);
  return new Ctor();
}

function appendPptxExt(name: string): string {
  return /\.pptx$/i.test(name) ? name : `${name}.pptx`;
}

/**
 * Build slides via pptxgenjs. Defensive against partial specs — empty
 * title / empty bullets fall back to the agent-provided structure rather
 * than throwing, so a malformed slide doesn't tank the whole export.
 */
function buildSlides(pptx: PptxLike, slides: Input['slides']): void {
  for (const spec of slides) {
    const slide = pptx.addSlide();
    if (spec.title) {
      slide.addText(spec.title, {
        x: 0.5,
        y: 0.3,
        w: '90%',
        h: 1,
        fontSize: 40,
        bold: true,
      });
    }
    if (spec.bullets && spec.bullets.length > 0) {
      slide.addText(
        spec.bullets.map((b) => ({ text: b, options: { bullet: true } })),
        {
          x: 0.5,
          y: 1.5,
          w: '90%',
          h: 5,
          fontSize: 20,
        },
      );
    }
    if (spec.images) {
      for (const img of spec.images) {
        slide.addImage({
          path: img.url,
          data: img.url.startsWith('data:') ? img.url : undefined,
          x: img.x,
          y: img.y,
          w: img.w,
          h: img.h,
          altText: img.alt,
        });
      }
    }
    if (spec.shapes) {
      for (const sh of spec.shapes) {
        slide.addShape(sh.kind, {
          x: sh.x,
          y: sh.y,
          w: sh.w,
          h: sh.h,
          fill: sh.fill ? { color: sh.fill } : undefined,
          line: sh.line ? { color: sh.line } : undefined,
        });
      }
    }
    if (spec.notes && typeof spec.notes === 'string' && spec.notes.length > 0) {
      if (typeof slide.addNotes === 'function') {
        slide.addNotes(spec.notes);
      } else {
        slide.notes = spec.notes;
      }
    }
  }
}

/**
 * Screenshots mode — one full-bleed image per slide. Speaker notes still
 * attach. Title / bullets / shapes are ignored if the agent set them.
 *
 * Each slide.image must already be a data: URI (resolution happens upstream
 * in resolveScreenshotsModeImages).
 */
function buildScreenshotSlides(
  pptx: PptxLike,
  slides: Input['slides'],
  widthIn: number,
  heightIn: number,
): void {
  for (const spec of slides) {
    const slide = pptx.addSlide();
    const url = spec.image ?? '';
    slide.addImage({
      ...(url.startsWith('data:') ? { data: url } : { path: url }),
      x: 0,
      y: 0,
      w: widthIn,
      h: heightIn,
    });
    if (spec.notes && spec.notes.length > 0) {
      if (typeof slide.addNotes === 'function') {
        slide.addNotes(spec.notes);
      } else {
        slide.notes = spec.notes;
      }
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Resolve every slide.image into a data: URI in place. Accepts:
 *   - `data:<mime>;base64,...`  — kept verbatim
 *   - `__pool:<key>[:<index>]`  — read from the in-memory screenshot pool
 *   - `http(s)://...`           — kept verbatim (pptxgenjs handles URL fetch)
 *   - `<project-relative path>` — fetched from the worker, base64-encoded
 *
 * On any unresolvable ref (404, malformed pool key, etc.) returns the
 * offending image string so the caller can build a precise error.
 */
async function resolveScreenshotsModeImages(
  projectId: string,
  slides: Input['slides'],
): Promise<{ ok: true } | { ok: false; failed: string }> {
  for (let i = 0; i < slides.length; i += 1) {
    const spec = slides[i]!;
    const ref = spec.image ?? '';
    if (!ref || ref.startsWith('data:') || /^https?:\/\//i.test(ref)) continue;
    if (ref.startsWith('__pool:')) {
      const rest = ref.slice('__pool:'.length);
      const colon = rest.lastIndexOf(':');
      const key = colon >= 0 ? rest.slice(0, colon) : rest;
      const idx = colon >= 0 ? Number(rest.slice(colon + 1)) : 0;
      if (!key || !Number.isFinite(idx) || idx < 0) {
        return { ok: false, failed: ref };
      }
      const blob = getScreenshotCapture(key, idx);
      if (!blob) return { ok: false, failed: ref };
      const buf = new Uint8Array(await new Response(blob).arrayBuffer());
      const mime = blob.type || 'image/png';
      spec.image = `data:${mime};base64,${bytesToBase64(buf)}`;
      continue;
    }
    // Project-relative path → fetch from worker.
    const path = ref.replace(/^\/+/, '');
    const url = buildUrl(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
    );
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      return { ok: false, failed: ref };
    }
    if (!res.ok) return { ok: false, failed: ref };
    const mime = res.headers.get('content-type') ?? 'image/png';
    const buf = new Uint8Array(await res.arrayBuffer());
    spec.image = `data:${mime};base64,${bytesToBase64(buf)}`;
  }
  return { ok: true };
}

export function genPptxTool(projectId: string, deps?: GenPptxDeps) {
  const pptxFactory = deps?.pptxFactory ?? defaultPptxFactory;
  const triggerDownload = deps?.triggerDownload ?? defaultTriggerDownload;

  return tool<Input, Output>({
    description:
      'Export the deck currently in this project to a .pptx file and trigger a download. Use "editable" mode (default) to emit native PowerPoint text/shapes/images (fully editable). Pass slides[] as structured specs — each slide takes title/bullets/images/shapes/notes. The deck must already be designed; this tool serializes, it does not generate content.',
    inputSchema: InputSchema,
    execute: async (input) => {
      const parsed = InputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: 'invalid_input',
          message: `gen_pptx input failed validation: ${parsed.error.message}`,
        };
      }
      const { mode, slides, width, height, outputFilename } = parsed.data;
      if (slides.length === 0) {
        return {
          ok: false,
          error: 'invalid_input',
          message: 'slides[] is required and cannot be empty.',
        };
      }
      // Sizing: pptxgenjs uses inches; standard slide DPI assumption is 96.
      const widthIn = (width ?? 1920) / 96;
      const heightIn = (height ?? 1080) / 96;

      if (mode === 'screenshots') {
        // Validate every slide has an `image`.
        for (let i = 0; i < slides.length; i += 1) {
          if (!slides[i]?.image) {
            return {
              ok: false,
              error: 'invalid_input',
              message: `slides[${i}].image is required for mode='screenshots'. Capture each slide via the screenshot tool first.`,
            };
          }
        }
        // Resolve refs (project-relative paths, __pool keys) into data URIs
        // before pptxgenjs serializes. Inline data: URIs and http(s) URLs
        // pass through unchanged.
        const resolved = await resolveScreenshotsModeImages(projectId, slides);
        if (!resolved.ok) {
          return {
            ok: false,
            error: 'render_failed',
            message: `Failed to resolve screenshots-mode image: "${resolved.failed}". Make sure the file exists in the project (for _screenshots/ refs) or the in-memory key is registered (for __pool: refs).`,
          };
        }
      }

      let pptx: PptxLike;
      try {
        pptx = (await pptxFactory()) as PptxLike;
        pptx.defineLayout({ name: 'OPEN_DESIGN', width: widthIn, height: heightIn });
        pptx.layout = 'OPEN_DESIGN';
        if (mode === 'screenshots') {
          buildScreenshotSlides(pptx, slides, widthIn, heightIn);
        } else {
          buildSlides(pptx, slides);
        }
      } catch (e) {
        return {
          ok: false,
          error: 'render_failed',
          message: `pptxgenjs failed while assembling slides: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      let blob: Blob;
      try {
        const result = await pptx.write({ outputType: 'blob' });
        if (result instanceof Blob) {
          blob = result;
        } else if (result instanceof Uint8Array) {
          const buf = new Uint8Array(result).buffer as ArrayBuffer;
          blob = new Blob([buf], {
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          });
        } else {
          // base64 fallback
          const bin = atob(result as string);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          blob = new Blob([bytes.buffer as ArrayBuffer], {
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          });
        }
      } catch (e) {
        return {
          ok: false,
          error: 'render_failed',
          message: `pptxgenjs.write failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      const filename = appendPptxExt(outputFilename ?? projectId);
      triggerDownload(blob, filename);

      return { ok: true, mode, slideCount: slides.length, bytes: blob.size, filename };
    },
  });
}
