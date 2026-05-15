// read_file — paginated UTF-8 file reader with guards:
//   default limit 2000 lines, per-line truncation at 2000 chars,
//   256KB size guard (only when no pagination), 25k-token guard (chars/4).
//
// Returns a formatted string for the LLM:
//   [File: <path>]
//   [<N> lines, <C> chars — showing all]   (when no pagination needed)
//   or
//   [<N> lines total — showing lines <a>-<b>. Use offset=<b> to continue.]
//
//   <content>

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileTool } from '../read-file';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: string | (() => string)): void {
  globalThis.fetch = (async () => {
    const text = typeof body === 'function' ? body() : body;
    return new Response(text, { status });
  }) as typeof fetch;
}

describe('read_file', () => {
  describe('schema', () => {
    it('description mentions 2000 line default + offset/limit', () => {
      const t = readFileTool('p');
      const desc = String(t.description);
      expect(desc).toMatch(/2000/);
      expect(desc).toMatch(/offset/i);
      expect(desc).toMatch(/limit/i);
    });

    it('accepts path alone', () => {
      const t = readFileTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'a.jsx' }).success).toBe(true);
    });

    it('accepts path + offset + limit', () => {
      const t = readFileTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({ path: 'a.jsx', offset: 100, limit: 50 }).success,
      ).toBe(true);
    });

    it('rejects negative offset', () => {
      const t = readFileTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'a.jsx', offset: -1 }).success).toBe(false);
    });
  });

  describe('formatted output', () => {
    it('prepends [File: <path>] and [N lines, C chars — showing all] header for a short file', async () => {
      const content = 'hello world\nbye world\n';
      mockFetch(200, content);
      const r = (await readFileTool('p1').execute!({ path: 'A.jsx' }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toContain('[File: A.jsx]');
      expect(r).toMatch(/\[3 lines, \d+ chars — showing all\]/);
      expect(r).toContain('hello world');
      expect(r).toContain('bye world');
    });

    it('returns paginated header when default 2000-line limit would clip', async () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join('\n');
      mockFetch(200, lines);
      const r = (await readFileTool('p1').execute!({ path: 'big.txt' }, ctx)) as string;
      expect(r).toMatch(/\[3000 lines total — showing lines 1-2000\. Use offset=2000 to continue\.\]/);
      expect(r).toContain('line 1');
      expect(r).toContain('line 2000');
      expect(r).not.toContain('line 2001');
    });

    it('respects explicit offset + limit', async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
      mockFetch(200, lines);
      const r = (await readFileTool('p1').execute!(
        { path: 'a.txt', offset: 10, limit: 5 },
        ctx,
      )) as string;
      expect(r).toMatch(/showing lines 11-15/);
      expect(r).toContain('line 11');
      expect(r).toContain('line 15');
      expect(r).not.toContain('line 16');
      expect(r).not.toContain('line 10');
    });
  });

  describe('per-line truncation', () => {
    it('truncates a >2000-char line and appends "[line truncated, N chars total]"', async () => {
      const longLine = 'x'.repeat(2500);
      const content = `short\n${longLine}\nalso short\n`;
      mockFetch(200, content);
      const r = (await readFileTool('p1').execute!({ path: 'a.txt' }, ctx)) as string;
      expect(r).toMatch(/\[line truncated, 2500 chars total\]/);
      // The truncated line in output is at most ~2000 chars before the marker
      const truncatedLine = r.split('\n').find((l) => l.includes('[line truncated'))!;
      expect(truncatedLine.length).toBeGreaterThan(2000);
      expect(truncatedLine.length).toBeLessThan(2600); // not the full 2500 chars
      expect(r).toContain('short');
      expect(r).toContain('also short');
    });
  });

  describe('size guard (256KB)', () => {
    it('rejects content > 256KB when no offset/limit specified', async () => {
      // Generate >256KB content (avoid line truncation by using newlines)
      const lines = Array.from({ length: 5000 }, (_, i) => 'x'.repeat(60)).join('\n');
      // 5000 * 61 chars ≈ 305KB
      mockFetch(200, lines);
      const r = (await readFileTool('p1').execute!({ path: 'huge.txt' }, ctx)) as string;
      expect(r).toMatch(/exceeds maximum allowed size \(256KB\)/);
      expect(r).toMatch(/offset and limit/i);
    });

    it('size guard does NOT trigger when offset OR limit is provided', async () => {
      const lines = Array.from({ length: 5000 }, (_, i) => 'x'.repeat(60)).join('\n');
      mockFetch(200, lines);
      const r = (await readFileTool('p1').execute!(
        { path: 'huge.txt', limit: 50 },
        ctx,
      )) as string;
      expect(r).not.toMatch(/exceeds maximum allowed size/);
      expect(r).toMatch(/showing lines 1-50/);
    });
  });

  describe('token guard (25000 tokens ~= 100000 chars)', () => {
    it('rejects when computed tokens (chars/4) exceeds 25000', async () => {
      // 5000 lines × 80 chars = 400000 chars → 100000 tokens estimate
      const lines = Array.from({ length: 5000 }, () => 'x'.repeat(80)).join('\n');
      mockFetch(200, lines);
      const r = (await readFileTool('p1').execute!(
        { path: 'huge.txt', limit: 5000 },
        ctx,
      )) as string;
      expect(r).toMatch(/exceeds maximum allowed tokens/);
    });
  });

  describe('errors', () => {
    it('returns error string on 404 (does not throw)', async () => {
      mockFetch(404, 'not found');
      const r = (await readFileTool('p1').execute!({ path: 'missing.jsx' }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/404|not.?found/i);
    });

    it('returns error string on 5xx (does not throw)', async () => {
      mockFetch(500, 'boom');
      const r = (await readFileTool('p1').execute!({ path: 'A.jsx' }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/500/);
    });
  });

  describe('URL encoding', () => {
    it('preserves slashes in path via encodeURI', async () => {
      let calledUrl = '';
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calledUrl = String(input);
        return new Response('x', { status: 200 });
      }) as typeof fetch;
      await readFileTool('p1').execute!({ path: 'src/components/Header.tsx' }, ctx);
      expect(calledUrl).toContain('/api/projects/p1/files/src/components/Header.tsx');
    });

    it('encodes projectId via encodeURIComponent', async () => {
      let calledUrl = '';
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calledUrl = String(input);
        return new Response('x', { status: 200 });
      }) as typeof fetch;
      await readFileTool('proj/with-slash').execute!({ path: 'A.jsx' }, ctx);
      expect(calledUrl).toContain('/api/projects/proj%2Fwith-slash/');
    });
  });

  describe('cross-project path syntax', () => {
    it('routes /projects/<otherId>/<rel> to the target project', async () => {
      let calledUrl = '';
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calledUrl = String(input);
        return new Response('content', { status: 200 });
      }) as typeof fetch;
      await readFileTool('current-proj').execute!(
        { path: '/projects/other-proj/src/x.ts' },
        ctx,
      );
      expect(calledUrl).toContain('/api/projects/other-proj/files/src/x.ts');
      expect(calledUrl).not.toContain('current-proj');
    });

    it('falls back to default project for plain paths', async () => {
      let calledUrl = '';
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        calledUrl = String(input);
        return new Response('content', { status: 200 });
      }) as typeof fetch;
      await readFileTool('current-proj').execute!({ path: 'src/x.ts' }, ctx);
      expect(calledUrl).toContain('/api/projects/current-proj/files/src/x.ts');
    });
  });
});
