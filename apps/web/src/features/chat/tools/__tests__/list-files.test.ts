// list_files — directory-aware listing with path/depth/offset/filter.
// Was a flat path-only list with empty schema. Aligned behavior renders
// 📁/📄 emoji, supports `path` scope (dir prefix), `depth` (default 1),
// `offset` for pagination, `filter` regex; caps at 200 entries per call
// and reports total/truncated.

import { describe, expect, it } from 'vitest';
import { listFilesTool } from '../list-files';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

function mockListResponse(paths: string[]): void {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        files: paths.map((p) => ({
          path: p,
          size: 100,
          mimeType: 'text/plain',
          updatedAt: '2026-05-13T00:00:00Z',
        })),
      }),
      { status: 200 },
    )) as typeof fetch;
}

describe('list_files', () => {
  describe('schema', () => {
    it('description mentions path / depth / offset / filter / 200', () => {
      const t = listFilesTool('p');
      const desc = String(t.description).toLowerCase();
      expect(desc).toMatch(/path|directory/);
      expect(desc).toMatch(/depth/);
      expect(desc).toMatch(/offset|paginate/);
      expect(desc).toMatch(/200/);
    });

    it('accepts the new params', () => {
      const t = listFilesTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({ path: 'src', depth: 2, offset: 0, filter: '\\.ts$' })
          .success,
      ).toBe(true);
    });

    it('accepts empty input (default = root, depth 1)', () => {
      const t = listFilesTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({}).success).toBe(true);
    });
  });

  describe('rendering', () => {
    it('renders 📁 for directories and 📄 for files at depth 1', async () => {
      mockListResponse([
        'index.html',
        'src/App.jsx',
        'src/components/Header.tsx',
        'README.md',
      ]);
      const r = (await listFilesTool('p').execute!({}, ctx)) as string;
      expect(r).toContain('📁 src');
      expect(r).toContain('📄 index.html');
      expect(r).toContain('📄 README.md');
      // src/App.jsx should NOT appear at depth=1 (it's deeper than 1 level)
      expect(r).not.toContain('App.jsx');
    });

    it('returns "(empty directory)" when the path has no entries', async () => {
      mockListResponse(['unrelated.md']);
      const r = (await listFilesTool('p').execute!({ path: 'nope' }, ctx)) as string;
      expect(r).toMatch(/empty directory/);
    });

    it('scopes to a subdirectory via `path`', async () => {
      mockListResponse([
        'src/App.jsx',
        'src/components/Header.tsx',
        'src/components/Footer.tsx',
        'docs/readme.md',
      ]);
      const r = (await listFilesTool('p').execute!({ path: 'src' }, ctx)) as string;
      expect(r).toContain('📁 components');
      expect(r).toContain('📄 App.jsx');
      expect(r).not.toContain('readme.md');
    });

    it('honors depth=2 to peek one level deeper', async () => {
      mockListResponse([
        'src/App.jsx',
        'src/components/Header.tsx',
        'src/components/Footer.tsx',
      ]);
      const r = (await listFilesTool('p').execute!({ path: 'src', depth: 2 }, ctx)) as string;
      expect(r).toContain('📄 App.jsx');
      expect(r).toContain('📁 components');
      expect(r).toContain('Header.tsx');
    });
  });

  describe('filter (regex)', () => {
    it('applies the filter regex to entry names', async () => {
      mockListResponse(['App.jsx', 'index.html', 'README.md', 'styles.css']);
      const r = (await listFilesTool('p').execute!({ filter: '\\.(jsx|css)$' }, ctx)) as string;
      expect(r).toContain('App.jsx');
      expect(r).toContain('styles.css');
      expect(r).not.toContain('README.md');
      expect(r).not.toContain('index.html');
    });
  });

  describe('pagination', () => {
    it('caps at 200 entries and reports truncated total', async () => {
      const paths = Array.from({ length: 250 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
      mockListResponse(paths);
      const r = (await listFilesTool('p').execute!({}, ctx)) as string;
      expect(r).toMatch(/Showing 200 of 250 results/);
      expect(r).toMatch(/offset=200/);
    });

    it('offset skips entries', async () => {
      const paths = Array.from({ length: 10 }, (_, i) => `f${i}.txt`);
      mockListResponse(paths);
      const r = (await listFilesTool('p').execute!({ offset: 5 }, ctx)) as string;
      expect(r).not.toContain('f4.txt');
      expect(r).toContain('f5.txt');
      expect(r).toContain('f9.txt');
    });
  });

  describe('errors', () => {
    it('returns error string on 404', async () => {
      globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
      const r = (await listFilesTool('p').execute!({}, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/error/i);
    });
  });

  describe('cross-project path syntax', () => {
    it('routes /projects/<otherId>/<dir> to the target project and scopes to <dir>', async () => {
      let calledUrl = '';
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calledUrl = String(input);
        return new Response(
          JSON.stringify({
            files: [
              { path: 'src/x.ts', size: 1, mimeType: 'text/plain', updatedAt: 'now' },
              { path: 'src/y.ts', size: 1, mimeType: 'text/plain', updatedAt: 'now' },
              { path: 'pkg/z.ts', size: 1, mimeType: 'text/plain', updatedAt: 'now' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch;
      const r = (await listFilesTool('current').execute!(
        { path: '/projects/other-proj/src' },
        ctx,
      )) as string;
      expect(calledUrl).toContain('/api/projects/other-proj/files');
      expect(calledUrl).not.toContain('current');
      // Result lists src/* but not pkg/* (path-scope filter applied).
      expect(r).toContain('x.ts');
      expect(r).toContain('y.ts');
      expect(r).not.toContain('z.ts');
    });
  });
});
