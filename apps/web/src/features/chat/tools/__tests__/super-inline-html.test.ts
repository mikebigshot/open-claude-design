// super_inline_html — bundles an HTML file and its referenced assets into
// a single self-contained HTML file written back to the project. Mirrors v2
// official tool name + I/O contract.
//
// Coverage: thumbnail validation, link-stylesheet inlining, script-src
// inlining, img-src data-URI inlining, idempotent on repeat runs, surfaces
// missing-asset / missing-thumbnail / write-failure errors.

import { describe, expect, it, vi } from 'vitest';
import { superInlineHtmlTool } from '../super-inline-html';

interface ToolInternals {
  execute: (input: unknown, ctx?: { abortSignal?: AbortSignal }) => Promise<unknown>;
  inputSchema: unknown;
  description?: string;
}

function asTool(t: unknown): ToolInternals {
  return t as ToolInternals;
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeTextResponse(body: string, type: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': type } });
}

function makeBytesResponse(bytes: Uint8Array, type: string, status = 200): Response {
  // Copy into a fresh ArrayBuffer so TS doesn't widen to SharedArrayBuffer.
  const buf = new Uint8Array(bytes).buffer as ArrayBuffer;
  return new Response(buf, { status, headers: { 'content-type': type } });
}

/** Wire up fetch + capture writes — returns a writer that records the
 *  PUT body so tests can assert what we sent back to the worker. */
function makeMockEnv(files: Record<string, { body: string | Uint8Array; type: string }>) {
  const writes: Array<{ url: string; body: string }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    // buildAssetUrl percent-encodes each path segment, so decode before
    // matching against unencoded fixture keys (e.g., `hero@1x.png`).
    const decoded = (() => {
      try {
        return decodeURIComponent(url);
      } catch {
        return url;
      }
    })();
    if (init?.method === 'PUT') {
      const text = typeof init.body === 'string' ? init.body : '';
      writes.push({ url: decoded, body: text });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    for (const [path, val] of Object.entries(files)) {
      if (decoded.endsWith(`/files/${path}`)) {
        return typeof val.body === 'string'
          ? makeTextResponse(val.body, val.type)
          : makeBytesResponse(val.body, val.type);
      }
    }
    if (url.includes('/files') && !url.includes('/files/')) {
      return makeJsonResponse({
        files: Object.keys(files).map((p) => ({
          path: p,
          mediaType: files[p]?.type ?? 'application/octet-stream',
        })),
      });
    }
    return new Response('not found', { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, writes };
}

const THUMBNAIL_TEMPLATE = `<template id="__bundler_thumbnail">
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#5e6ad2"/></svg>
</template>`;

describe('superInlineHtmlTool', () => {
  it('refuses to bundle when the source HTML lacks the __bundler_thumbnail template', async () => {
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': {
        body: '<html><body>no thumb</body></html>',
        type: 'text/html',
      },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = await t.execute({ input_path: 'src/index.html', output_path: 'out/index.html' });
    expect(out).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'missing_thumbnail',
        message: expect.stringMatching(/__bundler_thumbnail/),
      }),
    );
    expect(writes).toHaveLength(0);
  });

  it('inlines a same-folder stylesheet referenced via <link rel="stylesheet">', async () => {
    const html = `<html><head>
      ${THUMBNAIL_TEMPLATE}
      <link rel="stylesheet" href="theme.css">
    </head><body>hi</body></html>`;
    const css = 'body { background: #5e6ad2; color: white; }';
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/theme.css': { body: css, type: 'text/css' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = await t.execute({ input_path: 'src/index.html', output_path: 'src/out.html' });
    expect(out).toEqual(expect.objectContaining({ ok: true, output_path: 'src/out.html' }));
    expect(writes).toHaveLength(1);
    const bundled = writes[0]!.body;
    expect(bundled).not.toContain('href="theme.css"');
    expect(bundled).toMatch(/<style[^>]*>/);
    expect(bundled).toContain('#5e6ad2');
  });

  it('inlines a <script src> as <script>...</script>', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <script src="app.js"></script>
    </body></html>`;
    const js = 'console.log("hello");';
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/app.js': { body: js, type: 'application/javascript' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = await t.execute({ input_path: 'src/index.html', output_path: 'src/out.html' });
    expect(out).toEqual(expect.objectContaining({ ok: true }));
    const bundled = writes[0]!.body;
    expect(bundled).not.toContain('src="app.js"');
    expect(bundled).toContain('console.log("hello");');
  });

  it('inlines an <img src> as a data URI', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <img src="logo.png" alt="logo">
    </body></html>`;
    // 1×1 red PNG
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x03, 0x00, 0x01, 0x37, 0xa6, 0x52, 0x44, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/logo.png': { body: png, type: 'image/png' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = await t.execute({ input_path: 'src/index.html', output_path: 'src/out.html' });
    expect(out).toEqual(expect.objectContaining({ ok: true }));
    const bundled = writes[0]!.body;
    expect(bundled).not.toContain('src="logo.png"');
    expect(bundled).toMatch(/src="data:image\/png;base64,/);
  });

  it('handles a chained stylesheet + script + image bundle and reports the asset count', async () => {
    const html = `<html><head>
      ${THUMBNAIL_TEMPLATE}
      <link rel="stylesheet" href="a.css">
      <script src="b.js"></script>
    </head><body>
      <img src="c.png">
    </body></html>`;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { fetchImpl } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/a.css': { body: 'body{}', type: 'text/css' },
      'src/b.js': { body: 'var x=1;', type: 'application/javascript' },
      'src/c.png': { body: png, type: 'image/png' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = await t.execute({ input_path: 'src/index.html', output_path: 'src/out.html' });
    expect(out).toEqual(
      expect.objectContaining({
        ok: true,
        assetsInlined: 3,
      }),
    );
  });

  it('returns ok:false when the input HTML is not found', async () => {
    const { fetchImpl } = makeMockEnv({});
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = await t.execute({ input_path: 'missing.html', output_path: 'out.html' });
    expect(out).toEqual(expect.objectContaining({ ok: false, error: 'input_not_found' }));
  });

  it('continues even if an asset 404s, reports it in warnings list', async () => {
    const html = `<html><head>
      ${THUMBNAIL_TEMPLATE}
      <link rel="stylesheet" href="missing.css">
    </head><body>ok</body></html>`;
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = await t.execute({ input_path: 'src/index.html', output_path: 'src/out.html' });
    expect(out).toMatchObject({ ok: true });
    expect((out as { warnings?: string[] }).warnings ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/missing\.css/)]),
    );
    // The bundle is still written, just without the missing asset inlined.
    expect(writes).toHaveLength(1);
  });

  it('describes itself for the v2 catalog', () => {
    const t = asTool(superInlineHtmlTool('p1'));
    expect(t.description).toMatch(/self-contained|standalone|single/i);
    expect(t.description).toMatch(/inline/i);
  });

  // ── Phase 4 tail: extended asset coverage ─────────────────────────
  it('inlines a <video poster> + <video src> as data URIs', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <video src="clip.mp4" poster="thumb.jpg"></video>
    </body></html>`;
    const mp4 = new Uint8Array([0, 0, 0, 1]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/clip.mp4': { body: mp4, type: 'video/mp4' },
      'src/thumb.jpg': { body: jpg, type: 'image/jpeg' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    expect(out.assetsInlined).toBeGreaterThanOrEqual(2);
    const written = writes[0]?.body ?? '';
    expect(written).toMatch(/src="data:video\/mp4;base64,/);
    expect(written).toMatch(/poster="data:image\/jpeg;base64,/);
  });

  it('inlines an <audio src> as a data URI', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <audio src="sound.mp3" controls></audio>
    </body></html>`;
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/sound.mp3': { body: new Uint8Array([0xff, 0xfb, 0x90, 0x44]), type: 'audio/mpeg' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    expect(writes[0]?.body ?? '').toMatch(/src="data:audio\/mpeg;base64,/);
  });

  it('inlines <link rel="icon"> + variants as data URIs', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}
      <link rel="icon" href="favicon.ico">
      <link rel="apple-touch-icon" href="apple.png">
    </head><body>x</body></html>`;
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/favicon.ico': { body: new Uint8Array([0, 0, 1, 0]), type: 'image/x-icon' },
      'src/apple.png': { body: new Uint8Array([137, 80, 78, 71]), type: 'image/png' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    const body = writes[0]?.body ?? '';
    expect(body).toMatch(/href="data:image\/x-icon;base64,/);
    expect(body).toMatch(/href="data:image\/png;base64,/);
    expect(body).not.toContain('favicon.ico');
    expect(body).not.toContain('apple.png');
  });

  it('inlines <source src> inside <video>/<audio>', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <video controls><source src="clip.webm" type="video/webm"></video>
    </body></html>`;
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/clip.webm': { body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), type: 'video/webm' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    expect(writes[0]?.body ?? '').toMatch(/src="data:video\/webm;base64,/);
  });

  // ── Phase 4 tail extension: 10/10 asset families via DOMParser ────────
  it('inlines every <img srcset> candidate as data URIs (responsive imgs)', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <img src="hero@1x.png" srcset="hero@1x.png 1x, hero@2x.png 2x, hero@3x.png 3x">
    </body></html>`;
    const png = new Uint8Array([137, 80, 78, 71]);
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/hero@1x.png': { body: png, type: 'image/png' },
      'src/hero@2x.png': { body: png, type: 'image/png' },
      'src/hero@3x.png': { body: png, type: 'image/png' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    const body = writes[0]?.body ?? '';
    // srcset descriptors (1x/2x/3x) preserved
    expect(body).toMatch(/data:image\/png;base64,[A-Za-z0-9+/=]+ 1x/);
    expect(body).toMatch(/data:image\/png;base64,[A-Za-z0-9+/=]+ 2x/);
    expect(body).toMatch(/data:image\/png;base64,[A-Za-z0-9+/=]+ 3x/);
    expect(body).not.toContain('hero@1x.png');
    expect(body).not.toContain('hero@2x.png');
    expect(body).not.toContain('hero@3x.png');
  });

  it('inlines <picture><source srcset> with multiple candidates', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <picture>
        <source type="image/avif" srcset="banner.avif 800w, banner-2x.avif 1600w">
        <img src="banner.jpg" alt="banner">
      </picture>
    </body></html>`;
    const avif1 = new Uint8Array([0, 0, 0, 1]);
    const avif2 = new Uint8Array([0, 0, 0, 2]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/banner.avif': { body: avif1, type: 'image/avif' },
      'src/banner-2x.avif': { body: avif2, type: 'image/avif' },
      'src/banner.jpg': { body: jpg, type: 'image/jpeg' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    const body = writes[0]?.body ?? '';
    expect(body).toMatch(/data:image\/avif;base64,[A-Za-z0-9+/=]+ 800w/);
    expect(body).toMatch(/data:image\/avif;base64,[A-Za-z0-9+/=]+ 1600w/);
    expect(body).not.toContain('banner.avif');
    expect(body).not.toContain('banner-2x.avif');
  });

  it('inlines svg <image href> + svg <use href> + xlink:href', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <svg viewBox="0 0 100 100">
        <image href="bg.png" x="0" y="0" width="100" height="100"></image>
        <use href="sprite.svg#icon-a"></use>
        <use xlink:href="sprite.svg#icon-b"></use>
      </svg>
    </body></html>`;
    const png = new Uint8Array([137, 80, 78, 71]);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g id="icon-a"></g></svg>';
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/bg.png': { body: png, type: 'image/png' },
      'src/sprite.svg': { body: svg, type: 'image/svg+xml' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    const body = writes[0]?.body ?? '';
    // image href rewritten
    expect(body).toMatch(/data:image\/png;base64,/);
    expect(body).not.toContain('"bg.png"');
    // use href preserves fragment after rewrite to data: URI of SVG
    expect(body).toMatch(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#icon-a/);
    expect(body).toMatch(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+#icon-b/);
    expect(body).not.toContain('sprite.svg#icon-a');
    expect(body).not.toContain('sprite.svg#icon-b');
  });

  it('rewrites url(...) inside an inline <style> block (background + @font-face)', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}
      <style>
        @font-face { font-family: x; src: url('font.woff2') format('woff2'); }
        body { background: url("hero.png") center / cover; }
      </style>
    </head><body>hi</body></html>`;
    const woff = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
    const png = new Uint8Array([137, 80, 78, 71]);
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/font.woff2': { body: woff, type: 'font/woff2' },
      'src/hero.png': { body: png, type: 'image/png' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    const body = writes[0]?.body ?? '';
    expect(body).toMatch(/url\(['"]?data:font\/woff2;base64,[A-Za-z0-9+/=]+['"]?\)/);
    expect(body).toMatch(/url\(['"]?data:image\/png;base64,[A-Za-z0-9+/=]+['"]?\)/);
    expect(body).not.toContain('font.woff2');
    expect(body).not.toContain('hero.png');
  });

  it('rewrites url(...) inside an inline [style] attribute on any element', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}</head><body>
      <div style="background-image: url('cover.png'); color: red;">x</div>
    </body></html>`;
    const png = new Uint8Array([137, 80, 78, 71]);
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
      'src/cover.png': { body: png, type: 'image/png' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; assetsInlined: number };
    expect(out.ok).toBe(true);
    const body = writes[0]?.body ?? '';
    expect(body).toMatch(/url\(['"]?data:image\/png;base64,/);
    expect(body).not.toContain('cover.png');
  });

  it('skips data: and absolute URLs in srcset / url() (no rewrite, no warning)', async () => {
    const html = `<html><head>${THUMBNAIL_TEMPLATE}
      <style>body { background: url('https://cdn.example/x.png'); }</style>
    </head><body>
      <img srcset="data:image/png;base64,iVBORw0KGgo= 1x, https://cdn.example/img.png 2x">
    </body></html>`;
    const { fetchImpl, writes } = makeMockEnv({
      'src/index.html': { body: html, type: 'text/html' },
    });
    const t = asTool(superInlineHtmlTool('p1', { fetchImpl }));
    const out = (await t.execute({
      input_path: 'src/index.html',
      output_path: 'out.html',
    })) as { ok: true; warnings: string[] };
    expect(out.ok).toBe(true);
    // Source URLs preserved verbatim.
    const body = writes[0]?.body ?? '';
    expect(body).toContain('https://cdn.example/x.png');
    expect(body).toContain('data:image/png;base64,iVBORw0KGgo= 1x');
    expect(body).toContain('https://cdn.example/img.png 2x');
    // No spurious warnings for skipped (already-absolute) refs.
    expect(out.warnings.filter((w) => w.includes('cdn.example'))).toHaveLength(0);
  });
});
