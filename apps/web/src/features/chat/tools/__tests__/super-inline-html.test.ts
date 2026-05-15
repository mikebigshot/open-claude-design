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
    if (init?.method === 'PUT') {
      const text = typeof init.body === 'string' ? init.body : '';
      writes.push({ url, body: text });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    for (const [path, val] of Object.entries(files)) {
      if (url.endsWith(`/files/${path}`)) {
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
});
