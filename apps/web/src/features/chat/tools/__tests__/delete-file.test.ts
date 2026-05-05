import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteFileTool } from '../delete-file';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

afterEach(() => vi.restoreAllMocks());

describe('delete_file', () => {
  it('returns ok on 200', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    const r = await deleteFileTool('p').execute!({ path: 'A.jsx' }, ctx);
    expect(r).toEqual({ ok: true });
  });

  it('returns not_found on 404', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })) as typeof fetch;
    const r = await deleteFileTool('p').execute!({ path: 'A.jsx' }, ctx);
    expect(r).toMatchObject({ ok: false, error: 'not_found' });
  });
});
