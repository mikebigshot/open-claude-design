// write_file — aligned with official semantics:
//   - reject paths containing `#` (URL fragment identifier breaks navigation)
//   - accept viewport/{width,height?} + subtitle metadata params
//   - dispatch `file-written` CustomEvent after a successful write
//   - return "Wrote N characters to <path>" bare string

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileTool } from '../write-file';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface FileWrittenDetail {
  path: string;
}

function captureFileWritten(): { events: FileWrittenDetail[]; cleanup: () => void } {
  const events: FileWrittenDetail[] = [];
  const handler = (e: Event) => {
    events.push((e as CustomEvent<FileWrittenDetail>).detail);
  };
  window.addEventListener('file-written', handler as EventListener);
  return {
    events,
    cleanup: () => window.removeEventListener('file-written', handler as EventListener),
  };
}

function mockOk(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ sha256: 'deadbeef', size: 11 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

describe('write_file', () => {
  describe('schema', () => {
    it('accepts viewport {width} and subtitle', () => {
      const t = writeFileTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({
          path: 'a.jsx',
          content: 'x',
          subtitle: 'Indigo primary',
          viewport: { width: 1440 },
        }).success,
      ).toBe(true);
    });

    it('accepts viewport {width, height}', () => {
      const t = writeFileTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({
          path: 'a.jsx',
          content: 'x',
          viewport: { width: 1440, height: 900 },
        }).success,
      ).toBe(true);
    });

    it('still requires path + content', () => {
      const t = writeFileTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ content: 'x' }).success).toBe(false);
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'a' }).success).toBe(false);
    });
  });

  describe('# fragment rejection', () => {
    it('refuses paths containing # before making any fetch', async () => {
      let fetched = false;
      globalThis.fetch = (async () => {
        fetched = true;
        return new Response('', { status: 200 });
      }) as typeof fetch;

      const r = (await writeFileTool('p').execute!(
        { path: 'broken#path.jsx', content: 'x' },
        ctx,
      )) as string;
      expect(fetched).toBe(false);
      expect(typeof r).toBe('string');
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/#/);
      expect(r).toMatch(/fragment/i);
    });
  });

  describe('successful write', () => {
    it('PUTs the content and returns "Wrote N characters to <path>"', async () => {
      mockOk();
      const r = (await writeFileTool('p').execute!(
        { path: 'App.jsx', content: 'hello world' },
        ctx,
      )) as string;
      expect(typeof r).toBe('string');
      expect(r).toBe('Wrote 11 characters to App.jsx');
    });

    it('dispatches `file-written` CustomEvent with the path', async () => {
      mockOk();
      const capture = captureFileWritten();
      await writeFileTool('p').execute!({ path: 'index.html', content: '<html/>' }, ctx);
      capture.cleanup();
      expect(capture.events).toEqual([{ path: 'index.html' }]);
    });

    it('forwards asset / viewport / subtitle / mimeType to worker', async () => {
      let body: Record<string, unknown> | undefined;
      globalThis.fetch = (async (_url, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ sha256: 'a', size: 1 }), { status: 200 });
      }) as typeof fetch;

      await writeFileTool('p').execute!(
        {
          path: 'deck.html',
          content: 'x',
          asset: 'main',
          subtitle: 'v2 indigo',
          viewport: { width: 1440, height: 900 },
          mimeType: 'text/html',
        },
        ctx,
      );
      expect(body).toEqual({
        content: 'x',
        asset: 'main',
        subtitle: 'v2 indigo',
        viewport: { width: 1440, height: 900 },
        mimeType: 'text/html',
      });
    });

    it('omits optional fields when not provided', async () => {
      let body: Record<string, unknown> | undefined;
      globalThis.fetch = (async (_url, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ sha256: 'a', size: 1 }), { status: 200 });
      }) as typeof fetch;
      await writeFileTool('p').execute!({ path: 'A.jsx', content: 'x' }, ctx);
      expect(body).toEqual({ content: 'x' });
    });
  });

  describe('errors', () => {
    it('returns error string on non-2xx (does not throw)', async () => {
      globalThis.fetch = (async () =>
        new Response('boom', { status: 500, statusText: 'Server Error' })) as typeof fetch;
      const r = (await writeFileTool('p').execute!(
        { path: 'A.jsx', content: 'x' },
        ctx,
      )) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/500/);
    });
  });
});
