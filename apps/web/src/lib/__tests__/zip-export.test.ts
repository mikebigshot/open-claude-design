// zip-export — tests for bundleProjectAsZip + downloadProjectAsZip.
//
// We mock globalThis.fetch to simulate the worker REST API: GET .../files
// returns the manifest, and GET .../files/<path> returns the raw text content.
// The zip blob is then unzipped in-test (with the same JSZip we depend on)
// to verify the structure.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { FileRecord } from '@open-design/contracts';
import { bundleProjectAsZip, downloadProjectAsZip } from '../zip-export';

// jsdom's Blob lacks .arrayBuffer() / .text(); use FileReader instead.
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

function makeRecord(path: string, mimeType: FileRecord['mimeType'] = 'text/jsx'): FileRecord {
  return {
    projectId: 'proj-1',
    path,
    sha256: 'deadbeef',
    size: 10,
    mimeType,
    updatedAt: '2026-05-01T00:00:00Z',
  };
}

interface MockFile {
  path: string;
  content: string;
  mimeType?: string;
}

// Build a fetch mock keyed by URL substring → response factory.
function installFetchMock(
  manifest: FileRecord[],
  contents: Record<string, MockFile>,
): { fetchSpy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/files')) {
      return new Response(JSON.stringify({ files: manifest }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Match files/<path>
    const match = url.match(/\/files\/(.+)$/);
    if (match) {
      const path = decodeURIComponent(match[1]!);
      const file = contents[path];
      if (!file) {
        return new Response('not found', { status: 404 });
      }
      return new Response(file.content, {
        status: 200,
        headers: { 'content-type': file.mimeType ?? 'text/plain' },
      });
    }
    return new Response('unhandled', { status: 500 });
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return { fetchSpy: spy };
}

beforeEach(() => {
  // Reset any leftover document children
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bundleProjectAsZip', () => {
  it('packs every file in the manifest into a zip blob preserving paths', async () => {
    const manifest = [
      makeRecord('App.jsx'),
      makeRecord('src/Button.jsx'),
      makeRecord('styles.css', 'text/css'),
    ];
    installFetchMock(manifest, {
      'App.jsx': { path: 'App.jsx', content: 'export default function App(){}' },
      'src/Button.jsx': { path: 'src/Button.jsx', content: 'export const Button = () => null' },
      'styles.css': { path: 'styles.css', content: 'body { color: red; }' },
    });

    const blob = await bundleProjectAsZip('proj-1', 'demo');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);

    // Round-trip: read the produced zip and verify entries.
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    // JSZip auto-creates intermediate dir entries (e.g. "src/"); filter those.
    const fileNames = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    // 项目源文件 + 一个 standalone HTML wrapper：'<Project Name> Prototype.html'
    expect(fileNames).toEqual([
      'App.jsx',
      'demo Prototype.html',
      'src/Button.jsx',
      'styles.css',
    ]);
    expect(await zip.files['App.jsx']!.async('string')).toBe('export default function App(){}');
    expect(await zip.files['src/Button.jsx']!.async('string')).toBe(
      'export const Button = () => null',
    );
    expect(await zip.files['styles.css']!.async('string')).toBe('body { color: red; }');
    // wrapper HTML 含 React/Babel CDN
    const html = await zip.files['demo Prototype.html']!.async('string');
    expect(html).toContain('react@18.3.1');
    expect(html).toContain('@babel/standalone@7.29.0');
    expect(html).toContain('<script type="text/babel" src="./App.jsx"');
  });

  it('returns an empty zip for an empty manifest', async () => {
    installFetchMock([], {});
    const blob = await bundleProjectAsZip('proj-empty', 'demo');
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const realFiles = Object.values(zip.files).filter((f) => !f.dir);
    expect(realFiles).toEqual([]);
  });

  it('URL-encodes the project id and file paths', async () => {
    const manifest = [makeRecord('weird name.jsx')];
    const { fetchSpy } = installFetchMock(manifest, {
      'weird name.jsx': { path: 'weird name.jsx', content: '// hi' },
    });
    await bundleProjectAsZip('proj id with spaces', 'demo');
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    // Project id encoded with %20 (encodeURIComponent)
    expect(calledUrls.some((u) => u.includes('proj%20id%20with%20spaces'))).toBe(true);
    // File path uses encodeURI (preserves '/'); space → %20
    expect(calledUrls.some((u) => u.includes('weird%20name.jsx'))).toBe(true);
  });

  it('preserves .json file content byte-for-byte (no JSON round-trip)', async () => {
    // P1-9 fix: .json files are returned with content-type: application/json
    // by the worker. The old code went through api() which auto-parsed JSON
    // into an object, then re-stringified it — destroying original
    // formatting (indentation, key order, trailing newline). zip-export now
    // bypasses api() and reads raw text/bytes so .json files round-trip
    // verbatim.
    const original = '{\n  "name": "demo",\n  "version": "1.0.0",\n  "private": true\n}\n';
    const manifest = [makeRecord('package.json', 'application/json')];
    installFetchMock(manifest, {
      'package.json': {
        path: 'package.json',
        content: original,
        mimeType: 'application/json',
      },
    });
    const blob = await bundleProjectAsZip('proj-1', 'demo');
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const text = await zip.files['package.json']!.async('string');
    // Byte-for-byte match — original whitespace and key order preserved.
    expect(text).toBe(original);
  });

  it('preserves binary file content byte-for-byte (e.g. PNG)', async () => {
    // P1-9 fix (binary): when the worker returns content-type: image/png,
    // api() falls through to response.text() which mangles bytes. zip-export
    // must read arrayBuffer for binary mime types.
    const pngBytes = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG magic
      0x00,
      0x00,
      0x00,
      0x0d, // IHDR chunk size
      0x49,
      0x48,
      0x44,
      0x52, // "IHDR"
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01, // 1x1
      0x08,
      0x06,
      0x00,
      0x00,
      0x00,
      0x1f,
      0x15,
      0xc4,
      0x89,
    ]);
    const manifest = [makeRecord('icon.png', 'image/png')];
    // Custom fetch — the file response uses Uint8Array body so bytes survive.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/files')) {
        return new Response(JSON.stringify({ files: manifest }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('icon.png')) {
        return new Response(pngBytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('unhandled', { status: 500 });
    }) as typeof fetch;

    const blob = await bundleProjectAsZip('proj-1', 'demo');
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    const out = await zip.files['icon.png']!.async('uint8array');
    expect(Array.from(out)).toEqual(Array.from(pngBytes));
  });
});

describe('downloadProjectAsZip', () => {
  it('triggers a click on a temporary <a> with a derived filename', async () => {
    const manifest = [makeRecord('App.jsx')];
    installFetchMock(manifest, { 'App.jsx': { path: 'App.jsx', content: '' } });

    const createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    const revokeObjectURLSpy = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;

    // Spy on the anchor element's click() — jsdom's default does navigation.
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(
      (tag: string, opts?: ElementCreationOptions) => {
        const el = origCreateElement(tag, opts) as HTMLElement;
        if (tag === 'a') {
          (el as HTMLAnchorElement).click = clickSpy;
        }
        return el;
      },
    );

    try {
      await downloadProjectAsZip('proj-1', 'My Cool Demo!');
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      // Anchor should have been removed after click()
      expect(document.querySelector('a')).toBeNull();
    } finally {
      URL.createObjectURL = originalCreateURLOrThrow(originalCreate);
      URL.revokeObjectURL = originalRevokeOrThrow(originalRevoke);
    }
  });

  it('slugifies project name (lowercase + non-alnum → "-")', async () => {
    const manifest = [makeRecord('App.jsx')];
    installFetchMock(manifest, { 'App.jsx': { path: 'App.jsx', content: '' } });

    URL.createObjectURL = (() => 'blob:x') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as unknown as typeof URL.revokeObjectURL;

    let downloadAttr = '';
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(
      (tag: string, opts?: ElementCreationOptions) => {
        const el = origCreateElement(tag, opts) as HTMLElement;
        if (tag === 'a') {
          (el as HTMLAnchorElement).click = vi.fn();
          // Capture .download right after assignment
          Object.defineProperty(el, 'download', {
            set(v: string) {
              downloadAttr = v;
            },
            get() {
              return downloadAttr;
            },
            configurable: true,
          });
        }
        return el;
      },
    );

    await downloadProjectAsZip('proj-1', '  Hello World!! 2026  ');
    expect(downloadAttr).toBe('hello-world-2026.zip');
  });

  it('falls back to projectId when the slugified name is empty', async () => {
    const manifest = [makeRecord('App.jsx')];
    installFetchMock(manifest, { 'App.jsx': { path: 'App.jsx', content: '' } });

    URL.createObjectURL = (() => 'blob:x') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as unknown as typeof URL.revokeObjectURL;

    let downloadAttr = '';
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(
      (tag: string, opts?: ElementCreationOptions) => {
        const el = origCreateElement(tag, opts) as HTMLElement;
        if (tag === 'a') {
          (el as HTMLAnchorElement).click = vi.fn();
          Object.defineProperty(el, 'download', {
            set(v: string) {
              downloadAttr = v;
            },
            get() {
              return downloadAttr;
            },
            configurable: true,
          });
        }
        return el;
      },
    );

    await downloadProjectAsZip('proj-fallback-id', '!!!@@@###');
    expect(downloadAttr).toBe('proj-fallback-id.zip');
  });
});

// Helpers — restore even if the original was a non-writable getter.
function originalCreateURLOrThrow(orig: typeof URL.createObjectURL): typeof URL.createObjectURL {
  return orig;
}
function originalRevokeOrThrow(orig: typeof URL.revokeObjectURL): typeof URL.revokeObjectURL {
  return orig;
}
