// present_fs_item_for_download — fetches a project file (or zips a folder /
// project) and triggers a browser download. Mirrors v2 official tool name +
// input schema.
//
// The tool runs in the browser, so the download is immediate (one-shot).
// We DI `fetch`, `triggerDownload`, and `zipFolder` for deterministic tests.

import { describe, expect, it, vi } from 'vitest';
import { presentFsItemForDownloadTool } from '../present-for-download';

interface ToolInternals {
  execute: (
    input: { path?: string; label?: string; origin?: string },
    ctx?: { abortSignal?: AbortSignal },
  ) => Promise<unknown>;
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

function makeBlobResponse(text: string, contentType: string, status = 200): Response {
  const blob = new Blob([text], { type: contentType });
  return new Response(blob, { status, headers: { 'content-type': contentType } });
}

describe('presentFsItemForDownloadTool', () => {
  it('downloads a single file when path resolves to one file', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (/\/files($|\?)/.test(url)) {
        return makeJsonResponse({ files: [{ path: 'index.html', mediaType: 'text/html' }] });
      }
      if (url.endsWith('/files/index.html')) {
        return makeBlobResponse('<h1>hi</h1>', 'text/html');
      }
      throw new Error('unexpected url: ' + url);
    });
    const triggerDownload = vi.fn();
    const t = asTool(
      presentFsItemForDownloadTool('p1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        triggerDownload,
      }),
    );
    const out = await t.execute({ path: 'index.html', label: 'Deck' });
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob, filename] = triggerDownload.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toBe('index.html');
    expect(out).toEqual(
      expect.objectContaining({ ok: true, label: 'Deck', path: 'index.html', kind: 'file' }),
    );
  });

  it('defaults the label to the file basename when label is omitted', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (/\/files($|\?)/.test(url)) {
        return makeJsonResponse({ files: [{ path: 'deck.html', mediaType: 'text/html' }] });
      }
      return makeBlobResponse('x', 'text/html');
    });
    const triggerDownload = vi.fn();
    const t = asTool(
      presentFsItemForDownloadTool('p1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        triggerDownload,
      }),
    );
    const out = await t.execute({ path: 'deck.html' });
    expect(out).toEqual(expect.objectContaining({ ok: true, label: 'deck.html' }));
  });

  it('zips a folder when path resolves to multiple files (folder)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (/\/files($|\?)/.test(url)) {
        return makeJsonResponse({
          files: [
            { path: 'src/index.html', mediaType: 'text/html' },
            { path: 'src/app.css', mediaType: 'text/css' },
          ],
        });
      }
      if (url.endsWith('/files/src/index.html')) return makeBlobResponse('<html/>', 'text/html');
      if (url.endsWith('/files/src/app.css')) return makeBlobResponse('h1 {}', 'text/css');
      throw new Error('unexpected: ' + url);
    });
    const triggerDownload = vi.fn();
    const zipFolder = vi.fn(async (files: Record<string, Uint8Array>) => {
      // assertion: zipFolder receives both files keyed by relative path
      expect(Object.keys(files).sort()).toEqual(['app.css', 'index.html']);
      return new Blob(['ZIP'], { type: 'application/zip' });
    });
    const t = asTool(
      presentFsItemForDownloadTool('p1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        triggerDownload,
        zipFolder,
      }),
    );
    const out = await t.execute({ path: 'src', label: 'Source' });
    expect(zipFolder).toHaveBeenCalledTimes(1);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [blob, filename] = triggerDownload.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toBe('src.zip');
    expect(out).toEqual(
      expect.objectContaining({ ok: true, label: 'Source', path: 'src', kind: 'folder' }),
    );
  });

  it('zips the whole project when path is empty / omitted', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (/\/files($|\?)/.test(url)) {
        return makeJsonResponse({
          files: [
            { path: 'a.html', mediaType: 'text/html' },
            { path: 'b/c.txt', mediaType: 'text/plain' },
          ],
        });
      }
      if (url.endsWith('/files/a.html')) return makeBlobResponse('A', 'text/html');
      if (url.endsWith('/files/b/c.txt')) return makeBlobResponse('C', 'text/plain');
      throw new Error('unexpected: ' + url);
    });
    const triggerDownload = vi.fn();
    const zipFolder = vi.fn(async () => new Blob(['ZIP'], { type: 'application/zip' }));
    const t = asTool(
      presentFsItemForDownloadTool('p_demo', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        triggerDownload,
        zipFolder,
      }),
    );
    const out = await t.execute({});
    expect(zipFolder).toHaveBeenCalledTimes(1);
    expect(triggerDownload).toHaveBeenCalledTimes(1);
    const [, filename] = triggerDownload.mock.calls[0]!;
    expect(filename).toBe('p_demo.zip');
    expect(out).toEqual(
      expect.objectContaining({ ok: true, kind: 'project' }),
    );
  });

  it('returns not_found when the file API yields no matching files', async () => {
    const fetchImpl = vi.fn(async () => makeJsonResponse({ files: [] }));
    const triggerDownload = vi.fn();
    const t = asTool(
      presentFsItemForDownloadTool('p1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        triggerDownload,
      }),
    );
    const out = await t.execute({ path: 'missing.html' });
    expect(triggerDownload).not.toHaveBeenCalled();
    expect(out).toEqual(
      expect.objectContaining({ ok: false, error: 'not_found' }),
    );
  });

  it('propagates fetch errors as ok:false with a useful message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const triggerDownload = vi.fn();
    const t = asTool(
      presentFsItemForDownloadTool('p1', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        triggerDownload,
      }),
    );
    const out = await t.execute({ path: 'x.html' });
    expect(triggerDownload).not.toHaveBeenCalled();
    expect(out).toEqual(
      expect.objectContaining({ ok: false, error: 'fetch_failed' }),
    );
  });

  it('describes itself for the v2 catalog', () => {
    const t = asTool(presentFsItemForDownloadTool('p1'));
    expect(t.description).toMatch(/download/i);
  });
});
