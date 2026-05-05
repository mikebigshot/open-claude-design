// html-export — tests for exportAsStandaloneHtml.
//
// We mock the runtime helpers (buildSrcdoc, isHtmlOnlyBundle, pickHtmlEntry,
// buildHtmlSrcdoc) and globalThis.fetch (for api()) and verify the dispatch
// between the three branches:
//   1. HTML-only bundle → buildHtmlSrcdoc on the picked entry
//   2. HTML-only bundle but pickHtmlEntry returns null → fallback shell
//   3. Mixed bundle → buildSrcdoc with bundle files (no overlay/tweaks)
//   4. Either helper throws → fallback shell

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRecord } from '@open-design/contracts';

// jsdom's Blob lacks .text(); use FileReader instead.
function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsText(blob);
  });
}

// Hoist mocks before importing the module under test.
const buildSrcdocMock = vi.fn();
const buildHtmlSrcdocMock = vi.fn();
const isHtmlOnlyBundleMock = vi.fn();
const pickHtmlEntryMock = vi.fn();

vi.mock('@open-design/iframe-runtime/build-srcdoc', () => ({
  buildSrcdoc: buildSrcdocMock,
}));

vi.mock('@open-design/iframe-runtime/build-html-srcdoc', () => ({
  buildHtmlSrcdoc: buildHtmlSrcdocMock,
  isHtmlOnlyBundle: isHtmlOnlyBundleMock,
  pickHtmlEntry: pickHtmlEntryMock,
}));

// Import after vi.mock so the mocks land first.
const { exportAsStandaloneHtml } = await import('../html-export');

function makeRecord(path: string, mimeType: FileRecord['mimeType'] = 'text/jsx'): FileRecord {
  return {
    projectId: 'proj-1',
    path,
    sha256: 'deadbeef',
    size: 0,
    mimeType,
    updatedAt: '2026-05-01T00:00:00Z',
  };
}

interface MockFile {
  path: string;
  content: string;
  mimeType?: string;
}

function installFetchMock(manifest: FileRecord[], contents: Record<string, MockFile>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/files')) {
      return new Response(JSON.stringify({ files: manifest }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const match = url.match(/\/files\/(.+)$/);
    if (match) {
      const path = decodeURIComponent(match[1]!);
      const file = contents[path];
      if (!file) return new Response('not found', { status: 404 });
      return new Response(file.content, {
        status: 200,
        headers: { 'content-type': file.mimeType ?? 'text/plain' },
      });
    }
    return new Response('unhandled', { status: 500 });
  }) as typeof fetch;
}

beforeEach(() => {
  buildSrcdocMock.mockReset();
  buildHtmlSrcdocMock.mockReset();
  isHtmlOnlyBundleMock.mockReset();
  pickHtmlEntryMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('exportAsStandaloneHtml', () => {
  it('uses buildHtmlSrcdoc when bundle is HTML-only and an entry is found', async () => {
    const manifest = [makeRecord('index.html', 'text/html')];
    installFetchMock(manifest, {
      'index.html': { path: 'index.html', content: '<html><body>hi</body></html>' },
    });

    isHtmlOnlyBundleMock.mockReturnValue(true);
    pickHtmlEntryMock.mockImplementation((files: { path: string; content: string }[]) => files[0]);
    buildHtmlSrcdocMock.mockReturnValue('<!doctype html><html>built</html>');

    const blob = await exportAsStandaloneHtml('proj-1');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/html;charset=utf-8');
    const text = await blobToText(blob);
    expect(text).toBe('<!doctype html><html>built</html>');

    expect(buildHtmlSrcdocMock).toHaveBeenCalledWith('<html><body>hi</body></html>', {
      injectOverlay: false,
    });
    expect(buildSrcdocMock).not.toHaveBeenCalled();
  });

  it('renders fallback shell when isHtmlOnlyBundle but pickHtmlEntry returns null', async () => {
    const manifest = [makeRecord('weird.html', 'text/html')];
    installFetchMock(manifest, {
      'weird.html': { path: 'weird.html', content: '<html><body><h1>hi</h1></body></html>' },
    });

    isHtmlOnlyBundleMock.mockReturnValue(true);
    pickHtmlEntryMock.mockReturnValue(null);

    const blob = await exportAsStandaloneHtml('proj-1');
    const text = await blobToText(blob);
    // Fallback shell signature
    expect(text).toContain('Open Design');
    expect(text).toContain('<!doctype html>');
    expect(buildHtmlSrcdocMock).not.toHaveBeenCalled();
  });

  it('uses buildSrcdoc for mixed bundles, with overlay+tweaks injection disabled', async () => {
    const manifest = [makeRecord('App.jsx'), makeRecord('styles.css', 'text/css')];
    installFetchMock(manifest, {
      'App.jsx': { path: 'App.jsx', content: 'export default () => null' },
      'styles.css': { path: 'styles.css', content: 'body { color: red; }', mimeType: 'text/css' },
    });

    isHtmlOnlyBundleMock.mockReturnValue(false);
    buildSrcdocMock.mockReturnValue('<!doctype html><html>compiled bundle</html>');

    const blob = await exportAsStandaloneHtml('proj-1');
    expect(await blobToText(blob)).toBe('<!doctype html><html>compiled bundle</html>');
    expect(buildSrcdocMock).toHaveBeenCalledTimes(1);
    const [bundleArg, optionsArg] = buildSrcdocMock.mock.calls[0]!;
    expect(optionsArg).toEqual({ injectOverlay: false, injectTweaks: false });
    // bundle items pass through path / content / mimeType
    expect(bundleArg).toEqual([
      { path: 'App.jsx', content: 'export default () => null', mimeType: 'text/jsx' },
      { path: 'styles.css', content: 'body { color: red; }', mimeType: 'text/css' },
    ]);
  });

  it('falls back to shell when buildSrcdoc throws', async () => {
    const manifest = [makeRecord('App.jsx')];
    installFetchMock(manifest, { 'App.jsx': { path: 'App.jsx', content: '// boom' } });

    isHtmlOnlyBundleMock.mockReturnValue(false);
    buildSrcdocMock.mockImplementation(() => {
      throw new Error('parse failure');
    });

    const blob = await exportAsStandaloneHtml('proj-1');
    const text = await blobToText(blob);
    // Fallback shell signature: contains the file path inside a <details>
    expect(text).toContain('App.jsx');
    expect(text).toContain('Open Design');
  });

  it('falls back to shell when buildHtmlSrcdoc throws', async () => {
    const manifest = [makeRecord('index.html', 'text/html')];
    installFetchMock(manifest, {
      'index.html': { path: 'index.html', content: '<html><body>hi</body></html>' },
    });

    isHtmlOnlyBundleMock.mockReturnValue(true);
    pickHtmlEntryMock.mockImplementation((files: { path: string; content: string }[]) => files[0]);
    buildHtmlSrcdocMock.mockImplementation(() => {
      throw new Error('overlay inject failed');
    });

    const blob = await exportAsStandaloneHtml('proj-1');
    const text = await blobToText(blob);
    expect(text).toContain('Open Design');
  });

  it('escapes HTML special chars in fallback shell file content', async () => {
    const manifest = [makeRecord('evil.jsx')];
    installFetchMock(manifest, {
      'evil.jsx': {
        path: 'evil.jsx',
        content: '<script>alert("xss")</script>',
      },
    });

    isHtmlOnlyBundleMock.mockReturnValue(false);
    buildSrcdocMock.mockImplementation(() => {
      throw new Error('force fallback');
    });

    const blob = await exportAsStandaloneHtml('proj-1');
    const text = await blobToText(blob);
    // Raw <script> would execute; fallback shell escapes < to &lt;
    expect(text).not.toContain('<script>alert("xss")</script>');
    expect(text).toContain('&lt;script&gt;');
  });

  it('preserves .json file content byte-for-byte when passed to buildSrcdoc', async () => {
    // P1-9 fix: html-export was running .json files through api() which
    // auto-parsed and re-stringified them, mangling formatting. The fix
    // bypasses the JSON parse step so .json content survives intact.
    const originalPackageJson =
      '{\n  "name": "demo",\n  "version": "1.0.0",\n  "private": true\n}\n';
    const manifest = [makeRecord('App.jsx'), makeRecord('package.json', 'application/json')];
    installFetchMock(manifest, {
      'App.jsx': { path: 'App.jsx', content: 'export default () => null' },
      'package.json': {
        path: 'package.json',
        content: originalPackageJson,
        mimeType: 'application/json',
      },
    });

    isHtmlOnlyBundleMock.mockReturnValue(false);
    buildSrcdocMock.mockReturnValue('<!doctype html><html>compiled</html>');

    await exportAsStandaloneHtml('proj-1');
    const [bundleArg] = buildSrcdocMock.mock.calls[0]!;
    const pkg = (bundleArg as { path: string; content: string }[]).find(
      (b) => b.path === 'package.json',
    );
    expect(pkg).toBeDefined();
    expect(pkg!.content).toBe(originalPackageJson);
  });

  it('returns a text/html;charset=utf-8 Blob', async () => {
    const manifest = [makeRecord('index.html', 'text/html')];
    installFetchMock(manifest, {
      'index.html': { path: 'index.html', content: '<html></html>' },
    });
    isHtmlOnlyBundleMock.mockReturnValue(true);
    pickHtmlEntryMock.mockImplementation((files: { path: string; content: string }[]) => files[0]);
    buildHtmlSrcdocMock.mockReturnValue('<html>x</html>');

    const blob = await exportAsStandaloneHtml('proj-1');
    expect(blob.type).toBe('text/html;charset=utf-8');
  });
});
