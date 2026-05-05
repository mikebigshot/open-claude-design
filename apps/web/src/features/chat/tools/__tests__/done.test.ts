import { describe, expect, it } from 'vitest';
import { doneTool } from '../done';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('done', () => {
  it('returns ok with the supplied summary', async () => {
    const r = await doneTool().execute!({ summary: 'Built the landing page' }, ctx);
    expect(r).toEqual({ ok: true, message: 'Built the landing page' });
  });

  it('returns empty message when summary is omitted', async () => {
    const r = await doneTool().execute!({}, ctx);
    expect(r).toEqual({ ok: true, message: '' });
  });

  it('returns empty message when summary is explicitly empty string', async () => {
    const r = await doneTool().execute!({ summary: '' }, ctx);
    // Source uses `summary ?? ''` so empty string passes through unchanged
    expect(r).toEqual({ ok: true, message: '' });
  });

  it('does not perform any network I/O', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('', { status: 200 });
    }) as typeof fetch;
    await doneTool().execute!({ summary: 'x' }, ctx);
    expect(fetchCalled).toBe(false);
  });

  it('handles long multi-line summary', async () => {
    const summary = 'Line 1\nLine 2\nLine 3';
    const r = await doneTool().execute!({ summary }, ctx);
    expect(r).toEqual({ ok: true, message: summary });
  });
});
