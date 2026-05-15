// gen_pptx — exports the deck the agent built to a .pptx file via pptxgenjs.
// Mirrors v2 official tool name + input schema (mode / width / height / slides
// + 'editable' vs 'screenshots' modes). This test exercises 'editable' mode
// only; the screenshots variant ships under the same tool with a different
// captureSlide DI.
//
// Architecture: the tool is browser-side. pptxgenjs runs in-process; the
// caller produces a Blob; we hand it to the existing download trigger. Both
// pptxFactory and triggerDownload are DI'd so tests don't actually write the
// 750KB+ PowerPoint binary to disk.

import { describe, expect, it, vi } from 'vitest';
import { genPptxTool } from '../gen-pptx';

interface ToolInternals {
  execute: (input: unknown, ctx?: { abortSignal?: AbortSignal }) => Promise<unknown>;
  inputSchema: unknown;
  description?: string;
}

function asTool(t: unknown): ToolInternals {
  return t as ToolInternals;
}

interface FakeSlide {
  added: Array<{ kind: string; text?: string; opts?: Record<string, unknown> }>;
  notes: string | null;
}

/**
 * Minimal stand-in for the pptxgenjs PPTX class — captures every slide
 * mutation so tests can assert what the tool emitted without running the
 * real binary serializer.
 */
function makeFakePptx() {
  const slides: FakeSlide[] = [];
  let layoutDefined: { width?: number; height?: number; name?: string } | null = null;
  let title = '';
  let subject = '';
  const pptx = {
    defineLayout(spec: { width?: number; height?: number; name?: string }) {
      layoutDefined = spec;
    },
    set layout(name: string) {
      // pptxgenjs sets the layout by string match; we capture via defineLayout
    },
    get layout() {
      return layoutDefined?.name ?? '';
    },
    set title(v: string) {
      title = v;
    },
    get title() {
      return title;
    },
    set subject(v: string) {
      subject = v;
    },
    get subject() {
      return subject;
    },
    addSlide() {
      const slide: FakeSlide = { added: [], notes: null };
      const handle = {
        addText(text: string | unknown[], opts: Record<string, unknown>) {
          slide.added.push({
            kind: 'text',
            text: typeof text === 'string' ? text : JSON.stringify(text),
            opts,
          });
          return handle;
        },
        addImage(opts: Record<string, unknown>) {
          slide.added.push({ kind: 'image', opts });
          return handle;
        },
        addShape(_shape: unknown, opts: Record<string, unknown>) {
          slide.added.push({ kind: 'shape', opts });
          return handle;
        },
        set notes(v: string) {
          slide.notes = v;
        },
        get notes() {
          return slide.notes ?? '';
        },
        addNotes(v: string) {
          slide.notes = v;
        },
      };
      slides.push(slide);
      return handle;
    },
    async write({ outputType }: { outputType?: string } = {}) {
      const blob = new Blob([`FAKE_PPTX[${slides.length}slides]`], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      return outputType === 'blob' ? blob : new Uint8Array(0);
    },
  };
  return { pptx, slides, get layoutDefined() { return layoutDefined; }, get titleVal() { return title; } };
}

describe('genPptxTool — editable mode', () => {
  it('builds an editable PPTX with one slide per spec, returns ok:true and triggers a download', async () => {
    const fake = makeFakePptx();
    const triggerDownload = vi.fn();
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload,
      }),
    );
    const out = await t.execute({
      mode: 'editable',
      width: 1920,
      height: 1080,
      slides: [
        { title: 'Welcome', bullets: ['One', 'Two'], notes: 'Open with energy.' },
        { title: 'Problem', bullets: ['A', 'B', 'C'] },
        { title: 'Solution', bullets: [], notes: '' },
      ],
    });
    expect(out).toEqual(
      expect.objectContaining({ ok: true, mode: 'editable', slideCount: 3 }),
    );
    expect(fake.slides.length).toBe(3);
    // Layout sized to provided width/height (in inches; pptxgenjs uses inches).
    expect(fake.layoutDefined?.width).toBeCloseTo(20, 1);
    expect(fake.layoutDefined?.height).toBeCloseTo(11.25, 1);
    // Title + bullets present on first slide
    const firstTexts = fake.slides[0]!.added.filter((a) => a.kind === 'text');
    expect(firstTexts.length).toBeGreaterThanOrEqual(2);
    expect(firstTexts.some((a) => a.text === 'Welcome')).toBe(true);
    expect(firstTexts.some((a) => (a.text ?? '').includes('One'))).toBe(true);
    // Speaker notes attached for slides with notes
    expect(fake.slides[0]!.notes).toBe('Open with energy.');
    expect(fake.slides[1]!.notes).toBeNull();
    // Download triggered with filename ending .pptx
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob, filename] = triggerDownload.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toMatch(/\.pptx$/);
  });

  it('defaults width/height to 1920×1080 when omitted', async () => {
    const fake = makeFakePptx();
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    await t.execute({ slides: [{ title: 'X' }] });
    expect(fake.layoutDefined?.width).toBeCloseTo(20, 1); // 1920 / 96
    expect(fake.layoutDefined?.height).toBeCloseTo(11.25, 1); // 1080 / 96
  });

  it('uses outputFilename when provided, otherwise project-id-based default', async () => {
    const fakeA = makeFakePptx();
    const triggerA = vi.fn();
    const tA = asTool(
      genPptxTool('proj-99', {
        pptxFactory: () => fakeA.pptx as unknown as object,
        triggerDownload: triggerA,
      }),
    );
    await tA.execute({ slides: [{ title: 'X' }] });
    expect(triggerA.mock.calls[0]?.[1]).toBe('proj-99.pptx');

    const fakeB = makeFakePptx();
    const triggerB = vi.fn();
    const tB = asTool(
      genPptxTool('proj-99', {
        pptxFactory: () => fakeB.pptx as unknown as object,
        triggerDownload: triggerB,
      }),
    );
    await tB.execute({ slides: [{ title: 'X' }], outputFilename: 'My Deck.pptx' });
    expect(triggerB.mock.calls[0]?.[1]).toBe('My Deck.pptx');
  });

  it('appends a .pptx extension if outputFilename does not have one', async () => {
    const fake = makeFakePptx();
    const trigger = vi.fn();
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload: trigger,
      }),
    );
    await t.execute({ slides: [{ title: 'X' }], outputFilename: 'My Deck' });
    expect(trigger.mock.calls[0]?.[1]).toBe('My Deck.pptx');
  });

  it('returns ok:false when slides is empty', async () => {
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => makeFakePptx().pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    const out = await t.execute({ slides: [] });
    expect(out).toEqual(
      expect.objectContaining({ ok: false, error: 'invalid_input' }),
    );
  });

  it('returns ok:false when slides is missing entirely', async () => {
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => makeFakePptx().pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    const out = await t.execute({});
    expect(out).toEqual(
      expect.objectContaining({ ok: false }),
    );
  });

  it('catches pptxgenjs render errors and returns ok:false', async () => {
    const broken = {
      defineLayout() {
        /* ok */
      },
      addSlide() {
        return {
          addText() {
            return this;
          },
        };
      },
      async write() {
        throw new Error('pptx serialize failed');
      },
    };
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => broken as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    const out = await t.execute({ slides: [{ title: 'X' }] });
    expect(out).toEqual(
      expect.objectContaining({ ok: false, error: 'render_failed' }),
    );
  });

  it('handles slides with both bullets and an image', async () => {
    const fake = makeFakePptx();
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    await t.execute({
      slides: [
        {
          title: 'Demo',
          bullets: ['point 1'],
          images: [{ url: 'data:image/png;base64,iVBOR...', x: 5, y: 5, w: 10, h: 5 }],
        },
      ],
    });
    const added = fake.slides[0]!.added;
    expect(added.some((a) => a.kind === 'text' && a.text === 'Demo')).toBe(true);
    expect(added.some((a) => a.kind === 'image')).toBe(true);
  });

  it('describes itself for the v2 catalog', () => {
    const t = asTool(genPptxTool('proj-1'));
    expect(t.description).toMatch(/pptx/i);
    expect(t.description).toMatch(/deck/i);
  });
});

describe('genPptxTool — screenshots mode (Step G)', () => {
  it('emits one full-bleed image per slide and ignores editable-mode fields', async () => {
    const fake = makeFakePptx();
    const trigger = vi.fn();
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload: trigger,
      }),
    );
    const out = await t.execute({
      mode: 'screenshots',
      width: 1920,
      height: 1080,
      slides: [
        { image: 'data:image/png;base64,iVBOR...', notes: 'first' },
        { image: 'data:image/png;base64,iVBOR...', notes: '' },
      ],
    });
    expect(out).toEqual(expect.objectContaining({ ok: true, mode: 'screenshots', slideCount: 2 }));
    expect(fake.slides.length).toBe(2);
    // Each slide has exactly one image, no text
    for (const s of fake.slides) {
      const images = s.added.filter((a) => a.kind === 'image');
      const texts = s.added.filter((a) => a.kind === 'text');
      expect(images.length).toBe(1);
      expect(texts.length).toBe(0);
    }
    // First slide carries notes
    expect(fake.slides[0]!.notes).toBe('first');
    expect(fake.slides[1]!.notes).toBeNull();
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0]?.[1]).toMatch(/\.pptx$/);
  });

  it('fits each image to the configured slide dimensions in inches', async () => {
    const fake = makeFakePptx();
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    await t.execute({
      mode: 'screenshots',
      width: 1280,
      height: 720,
      slides: [{ image: 'data:image/png;base64,zzz' }],
    });
    const imageEntry = fake.slides[0]!.added.find((a) => a.kind === 'image');
    expect(imageEntry?.opts?.x).toBe(0);
    expect(imageEntry?.opts?.y).toBe(0);
    // 1280 / 96 = 13.333, 720 / 96 = 7.5
    expect(imageEntry?.opts?.w).toBeCloseTo(13.333, 2);
    expect(imageEntry?.opts?.h).toBeCloseTo(7.5, 2);
  });

  it('returns ok:false when a screenshots-mode slide is missing `image`', async () => {
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => makeFakePptx().pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    const out = await t.execute({
      mode: 'screenshots',
      slides: [{ image: 'data:image/png;base64,x' }, { notes: 'second slide forgot image' }],
    });
    expect(out).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'invalid_input',
        message: expect.stringMatching(/slides\[1\]\.image/),
      }),
    );
  });

  // ── Step G screenshots-mode resolution: `_screenshots/<uuid>.png` and
  //    `__pool:<key>:<idx>` should resolve into data URIs before pptxgenjs
  //    serializes. The agent shouldn't need to manually inline frames. ──
  it("resolves a project-relative path (e.g. _screenshots/<uuid>.png) by fetching the worker", async () => {
    const fake = makeFakePptx();
    // 1×1 PNG bytes for the worker response.
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/files/_screenshots/')) {
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    const out = await t.execute({
      mode: 'screenshots',
      width: 1280,
      height: 720,
      slides: [
        { image: '_screenshots/aaa.png' },
        { image: '_screenshots/bbb.png' },
      ],
    });
    expect(out).toEqual(expect.objectContaining({ ok: true, slideCount: 2 }));
    expect(fake.slides).toHaveLength(2);
    for (const s of fake.slides) {
      const img = s.added.find((a) => a.kind === 'image');
      const opts = img?.opts as { data?: string; path?: string } | undefined;
      // The path MUST have been resolved into a data URI before pptxgenjs sees it.
      expect(opts?.data).toMatch(/^data:image\/png;base64,/);
      expect(opts?.path).toBeUndefined();
    }
  });

  it('resolves __pool:<key>:<index> by reading from the in-memory screenshot pool (no fetch)', async () => {
    const fake = makeFakePptx();
    const { setScreenshotCaptures, _resetScreenshotPool } = await import(
      '../../lib/screenshot-pool'
    );
    _resetScreenshotPool();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    setScreenshotCaptures('frames', [
      new Blob([new Uint8Array(png).buffer as ArrayBuffer], { type: 'image/png' }),
      new Blob([new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer], { type: 'image/png' }),
    ]);
    globalThis.fetch = (async () => {
      throw new Error('fetch should not be called for __pool: refs');
    }) as typeof fetch;
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    const out = await t.execute({
      mode: 'screenshots',
      slides: [{ image: '__pool:frames:0' }, { image: '__pool:frames:1' }],
    });
    expect(out).toEqual(expect.objectContaining({ ok: true, slideCount: 2 }));
    for (const s of fake.slides) {
      const img = s.added.find((a) => a.kind === 'image');
      const opts = img?.opts as { data?: string; path?: string } | undefined;
      expect(opts?.data).toMatch(/^data:image\/png;base64,/);
      expect(opts?.path).toBeUndefined();
    }
  });

  it('returns ok:false with a clear message when an _screenshots/ ref 404s', async () => {
    const fake = makeFakePptx();
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
    const t = asTool(
      genPptxTool('proj-1', {
        pptxFactory: () => fake.pptx as unknown as object,
        triggerDownload: vi.fn(),
      }),
    );
    const out = await t.execute({
      mode: 'screenshots',
      slides: [{ image: '_screenshots/missing.png' }],
    });
    expect(out).toMatchObject({ ok: false });
    expect(String((out as { message?: string }).message ?? '')).toMatch(/_screenshots\/missing\.png/);
  });
});
