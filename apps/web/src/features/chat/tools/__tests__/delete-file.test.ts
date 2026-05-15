// delete_file — batch + recursive. Accepts `paths: string[]`; each entry is
// either a single file path or a directory path (recursive). Was a single
// `path` schema with non-recursive worker semantics.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteFileTool } from '../delete-file';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

afterEach(() => vi.restoreAllMocks());

describe('delete_file', () => {
  describe('schema', () => {
    it('description mentions paths array + recursive', () => {
      const t = deleteFileTool('p');
      const desc = String(t.description).toLowerCase();
      expect(desc).toMatch(/path/);
      expect(desc).toMatch(/recursive|folder/);
    });

    it('accepts a single-entry paths array', () => {
      const t = deleteFileTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ paths: ['a.txt'] }).success).toBe(true);
    });

    it('accepts multiple paths', () => {
      const t = deleteFileTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ paths: ['a', 'b', 'c'] }).success).toBe(true);
    });

    it('rejects empty paths array', () => {
      const t = deleteFileTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ paths: [] }).success).toBe(false);
    });

    it('rejects single `path` (old shape)', () => {
      const t = deleteFileTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'a.txt' }).success).toBe(false);
    });
  });

  describe('request shape', () => {
    it('POSTs to /:id/files/delete with paths array body', async () => {
      let calledUrl = '';
      let calledBody: unknown;
      let calledMethod = '';
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input);
        calledMethod = init?.method ?? 'GET';
        calledBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 });
      }) as typeof fetch;

      await deleteFileTool('p1').execute!({ paths: ['a.txt', 'docs/'] }, ctx);
      expect(calledUrl).toBe('/api/projects/p1/files/delete');
      expect(calledMethod).toBe('POST');
      expect(calledBody).toEqual({ paths: ['a.txt', 'docs/'] });
    });
  });

  describe('result formatting', () => {
    it('returns a per-path summary string for the LLM', async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            results: [
              { path: 'a.txt', deleted: 1 },
              { path: 'docs/', deleted: 5 },
              { path: 'gone.md', deleted: 0 },
            ],
          }),
          { status: 200 },
        )) as typeof fetch;

      const r = (await deleteFileTool('p').execute!(
        { paths: ['a.txt', 'docs/', 'gone.md'] },
        ctx,
      )) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/Deleted a\.txt/);
      expect(r).toMatch(/Deleted docs\/ \(5 files\)/);
      expect(r).toMatch(/No file or folder found at gone\.md/);
    });

    it('returns error string on 4xx/5xx', async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: 'boom' }), { status: 500 })) as typeof fetch;
      const r = (await deleteFileTool('p').execute!({ paths: ['x'] }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/500/);
    });
  });
});
