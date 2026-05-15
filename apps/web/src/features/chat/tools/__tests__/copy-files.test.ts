// copy_files — `[{src, dest, move?, asset?}]` per-file batch. Was a flat
// `{sources, dest_dir}` shared-destDir API.
//
// `move: true` removes the src after copy (treat as rename). `asset` is
// reserved for assets-manifest registration in a later phase; the worker
// accepts it but Phase 1 doesn't propagate it into the registry yet.

import { describe, expect, it } from 'vitest';
import { copyFilesTool } from '../copy-files';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('copy_files', () => {
  describe('schema', () => {
    it('description mentions per-file copy + move + dest', () => {
      const t = copyFilesTool('p');
      const desc = String(t.description).toLowerCase();
      expect(desc).toMatch(/copy/);
      expect(desc).toMatch(/move|rename/);
    });

    it('accepts `files` array of {src, dest}', () => {
      const t = copyFilesTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({
          files: [{ src: 'a.png', dest: 'assets/a.png' }],
        }).success,
      ).toBe(true);
    });

    it('accepts move:true and asset on a file entry', () => {
      const t = copyFilesTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({
          files: [{ src: 'a.png', dest: 'b.png', move: true, asset: 'logo' }],
        }).success,
      ).toBe(true);
    });

    it('rejects the old {sources, dest_dir} shape', () => {
      const t = copyFilesTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({ sources: ['a.png'], dest_dir: 'b/' }).success,
      ).toBe(false);
    });

    it('rejects empty files array', () => {
      const t = copyFilesTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ files: [] }).success).toBe(false);
    });
  });

  describe('request shape', () => {
    it('POSTs `{files: [...]}` body verbatim', async () => {
      let body: unknown;
      globalThis.fetch = (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 });
      }) as typeof fetch;
      await copyFilesTool('p').execute!(
        {
          files: [
            { src: 'a.png', dest: 'assets/a.png' },
            { src: 'old.md', dest: 'new.md', move: true },
          ],
        },
        ctx,
      );
      expect(body).toEqual({
        files: [
          { src: 'a.png', dest: 'assets/a.png' },
          { src: 'old.md', dest: 'new.md', move: true },
        ],
      });
    });
  });

  describe('result formatting', () => {
    it('returns per-file Copied / Moved summary string', async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            results: [
              { src: 'a.png', dest: 'assets/a.png', moved: false },
              { src: 'old.md', dest: 'new.md', moved: true },
            ],
          }),
          { status: 200 },
        )) as typeof fetch;
      const r = (await copyFilesTool('p').execute!(
        {
          files: [
            { src: 'a.png', dest: 'assets/a.png' },
            { src: 'old.md', dest: 'new.md', move: true },
          ],
        },
        ctx,
      )) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/Copied a\.png → assets\/a\.png/);
      expect(r).toMatch(/Moved old\.md → new\.md/);
    });

    it('returns error string on non-2xx', async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: 'missing src' }), { status: 400 })) as typeof fetch;
      const r = (await copyFilesTool('p').execute!(
        { files: [{ src: 'x', dest: 'y' }] },
        ctx,
      )) as string;
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/400/);
    });
  });
});
