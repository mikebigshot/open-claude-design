import { describe, expect, it } from 'vitest';
import { copyFilesTool } from '../copy-files';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('copy_files', () => {
  it('posts {sources, destDir} and returns the copied list', async () => {
    let body: unknown;
    globalThis.fetch = (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ ok: true, copied: [{ from: 'a.png', to: 'assets/a.png' }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const r = await copyFilesTool('p').execute!({ sources: ['a.png'], dest_dir: 'assets/' }, ctx);
    expect(body).toEqual({ sources: ['a.png'], destDir: 'assets/' });
    expect(r).toEqual({ ok: true, copied: [{ from: 'a.png', to: 'assets/a.png' }] });
  });
});
