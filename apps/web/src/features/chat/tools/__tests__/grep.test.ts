// grep — regex search (case-insensitive by default), returns each match with
// ±2 lines of surrounding context, caps at 100 matches, and accepts `path`
// (dir or file scope) instead of `include` (substring).

import { describe, expect, it } from 'vitest';
import { grepTool } from '../grep';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

interface GrepMatch {
  path: string;
  line: number;
  before: string[];
  match: string;
  after: string[];
}

describe('grep', () => {
  describe('schema', () => {
    it('description mentions regex + case-insensitive + ±2 lines + 100 cap', () => {
      const t = grepTool('p');
      const desc = String(t.description).toLowerCase();
      expect(desc).toMatch(/regex|pattern/);
      expect(desc).toMatch(/case[- ]?insensitive/);
      expect(desc).toMatch(/2\s*lines?|surround/);
      expect(desc).toMatch(/100/);
    });

    it('accepts pattern + path', () => {
      const t = grepTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ pattern: 'foo', path: 'src/' }).success).toBe(true);
    });

    it('rejects empty pattern', () => {
      const t = grepTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ pattern: '' }).success).toBe(false);
    });

    it('rejects the old `include` parameter name', () => {
      const t = grepTool('p');
      const r = asSchema(t.inputSchema)?.safeParse({ pattern: 'foo', include: 'src/' });
      // Schema must not silently accept stale arg names; either reject
      // outright or drop `include` without forwarding it.
      // We assert strict rejection.
      expect(r?.success).toBe(false);
    });
  });

  describe('request shape', () => {
    it('passes `path` to the worker (not `include`)', async () => {
      let body: unknown;
      globalThis.fetch = (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, matches: [], truncated: false }), {
          status: 200,
        });
      }) as typeof fetch;
      await grepTool('p').execute!({ pattern: 'bar', path: 'src/' }, ctx);
      expect(body).toEqual({ pattern: 'bar', path: 'src/' });
    });

    it('omits path when not provided', async () => {
      let body: unknown;
      globalThis.fetch = (async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true, matches: [], truncated: false }), {
          status: 200,
        });
      }) as typeof fetch;
      await grepTool('p').execute!({ pattern: 'baz' }, ctx);
      expect(body).toEqual({ pattern: 'baz' });
    });
  });

  describe('result formatting', () => {
    it('formats matches with ±2 line context as a readable string for the LLM', async () => {
      const matches: GrepMatch[] = [
        {
          path: 'src/foo.ts',
          line: 5,
          before: ['line three', 'line four'],
          match: 'match here',
          after: ['line six', 'line seven'],
        },
      ];
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ ok: true, matches, truncated: false }),
          { status: 200 },
        )) as typeof fetch;
      const r = (await grepTool('p').execute!({ pattern: 'match' }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/1 match\(es\)/);
      expect(r).toContain('src/foo.ts:5');
      expect(r).toContain('line three');
      expect(r).toContain('match here');
      expect(r).toContain('line seven');
      // Use `>` (or similar marker) to highlight the matched line
      expect(r).toMatch(/>\s*5/);
    });

    it('reports truncation flag when worker says truncated:true', async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            truncated: true,
            matches: Array.from({ length: 100 }, (_, i) => ({
              path: 'x.txt',
              line: i + 1,
              before: [],
              match: `hit ${i + 1}`,
              after: [],
            })),
          }),
          { status: 200 },
        )) as typeof fetch;
      const r = (await grepTool('p').execute!({ pattern: 'hit' }, ctx)) as string;
      expect(r).toMatch(/truncated/i);
      expect(r).toMatch(/100/);
    });

    it('returns "(no matches)" friendly string when nothing hits', async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ ok: true, matches: [], truncated: false }), {
          status: 200,
        })) as typeof fetch;
      const r = (await grepTool('p').execute!({ pattern: 'nope' }, ctx)) as string;
      expect(r).toMatch(/no matches|0 match/i);
    });
  });

  describe('error paths', () => {
    it('returns error string (not throw) on 4xx so the LLM can recover', async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: 'bad_pattern' }), { status: 400 })) as typeof fetch;
      const r = (await grepTool('p').execute!({ pattern: 'x' }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/400/);
    });
  });
});
