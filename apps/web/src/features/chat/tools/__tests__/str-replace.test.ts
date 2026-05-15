// str_replace_based_edit_tool — atomic edit via single RPC. Was GET+PUT
// client-side (non-atomic, race-prone). Now POST /:id/files-edit with
// `{edits: [{old_string, new_string}]}` body and worker-side D1 lock +
// uniqueness check.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strReplaceBasedEditTool } from '../str-replace-based-edit-tool';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface FileWrittenDetail {
  path: string;
}

function captureFileWritten(): { events: FileWrittenDetail[]; cleanup: () => void } {
  const events: FileWrittenDetail[] = [];
  const handler = (e: Event) =>
    events.push((e as CustomEvent<FileWrittenDetail>).detail);
  window.addEventListener('file-written', handler as EventListener);
  return {
    events,
    cleanup: () => window.removeEventListener('file-written', handler as EventListener),
  };
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

describe('str_replace_based_edit_tool', () => {
  describe('schema', () => {
    it('accepts single edit shorthand {path, old_string, new_string}', () => {
      const t = strReplaceBasedEditTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({
          path: 'A.jsx',
          old_string: 'foo',
          new_string: 'bar',
        }).success,
      ).toBe(true);
    });

    it('accepts batch edits array', () => {
      const t = strReplaceBasedEditTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({
          path: 'A.jsx',
          edits: [
            { old_string: 'a', new_string: 'b' },
            { old_string: 'c', new_string: 'd' },
          ],
        }).success,
      ).toBe(true);
    });

    it('rejects neither shorthand nor edits provided', () => {
      const t = strReplaceBasedEditTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'A.jsx' }).success).toBe(false);
    });
  });

  describe('single-RPC atomic edit', () => {
    it('POSTs to /:id/files-edit with edits array body and returns success string', async () => {
      let calledUrl = '';
      let calledMethod = '';
      let body: unknown;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input);
        calledMethod = init?.method ?? 'GET';
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ ok: true, path: 'A.jsx', sha256: 'aaa', size: 7, editsApplied: 1 }),
          { status: 200 },
        );
      }) as typeof fetch;

      const t = strReplaceBasedEditTool('p1');
      const r = (await t.execute!(
        { path: 'A.jsx', old_string: 'hello', new_string: 'HI' },
        ctx,
      )) as string;
      expect(calledUrl).toBe('/api/projects/p1/files-edit');
      expect(calledMethod).toBe('POST');
      expect(body).toEqual({
        path: 'A.jsx',
        edits: [{ old_string: 'hello', new_string: 'HI' }],
      });
      expect(typeof r).toBe('string');
      expect(r).toMatch(/Applied 1 edit to A\.jsx/);
    });

    it('forwards batch edits[] verbatim', async () => {
      let body: { edits: unknown[] } | undefined;
      globalThis.fetch = (async (_url, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as { edits: unknown[] };
        return new Response(
          JSON.stringify({ ok: true, path: 'A.jsx', sha256: 'b', size: 1, editsApplied: 2 }),
          { status: 200 },
        );
      }) as typeof fetch;
      const t = strReplaceBasedEditTool('p1');
      await t.execute!(
        {
          path: 'A.jsx',
          edits: [
            { old_string: 'a', new_string: 'A' },
            { old_string: 'b', new_string: 'B' },
          ],
        },
        ctx,
      );
      expect(body?.edits).toEqual([
        { old_string: 'a', new_string: 'A' },
        { old_string: 'b', new_string: 'B' },
      ]);
    });

    it('dispatches file-written CustomEvent on success', async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ ok: true, path: 'A.jsx', sha256: 'a', size: 1, editsApplied: 1 }),
          { status: 200 },
        )) as typeof fetch;
      const cap = captureFileWritten();
      await strReplaceBasedEditTool('p1').execute!(
        { path: 'A.jsx', old_string: 'x', new_string: 'y' },
        ctx,
      );
      cap.cleanup();
      expect(cap.events).toEqual([{ path: 'A.jsx' }]);
    });
  });

  describe('errors', () => {
    it('returns error string when worker reports not_found', async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })) as typeof fetch;
      const r = (await strReplaceBasedEditTool('p1').execute!(
        { path: 'X', old_string: 'a', new_string: 'b' },
        ctx,
      )) as string;
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/404|not.?found/i);
    });

    it('returns error string when worker reports multiple matches (422)', async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ error: 'multiple_matches', count: 3, editIndex: 0 }),
          { status: 422 },
        )) as typeof fetch;
      const r = (await strReplaceBasedEditTool('p1').execute!(
        { path: 'X', old_string: 'foo', new_string: 'bar' },
        ctx,
      )) as string;
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/multiple|3/);
    });
  });
});
