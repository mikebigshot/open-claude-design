// set_project_title — rename the current project, but only when the existing
// name is a placeholder (`""` or `"Design System"`). This mirrors the
// claude.ai/design bundle Bu8zJzmd guard so the tool can be called liberally
// without clobbering a name the user picked themselves.

import { describe, expect, it } from 'vitest';
import { setProjectTitleTool } from '../set-project-title';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

type FetchCall = { url: string; method: string; body?: unknown };

function installFetchSequence(
  responses: { url?: string | RegExp; status?: number; body: unknown }[],
): FetchCall[] {
  const calls: FetchCall[] = [];
  let idx = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const r = responses[idx++] ?? responses[responses.length - 1];
    return new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

describe('set_project_title', () => {
  it('rejects empty title', () => {
    const t = setProjectTitleTool('p1');
    expect(asSchema(t.inputSchema)?.safeParse({ title: '' }).success).toBe(false);
  });

  it('rejects title >120 chars', () => {
    const t = setProjectTitleTool('p1');
    expect(asSchema(t.inputSchema)?.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
  });

  it('rejects whitespace-only title at execute() time', async () => {
    const calls = installFetchSequence([{ body: {} }]);
    const r = (await setProjectTitleTool('p1').execute!({ title: '   ' }, ctx)) as string;
    expect(r).toMatch(/error/i);
    // Whitespace check is a client-side guard — no network calls.
    expect(calls).toHaveLength(0);
  });

  describe('placeholder-name guard (no-op if already named)', () => {
    it('renames when current name is empty string', async () => {
      const calls = installFetchSequence([
        { body: { id: 'p1', name: '' } },
        { body: { id: 'p1', name: 'New' } },
      ]);
      const r = (await setProjectTitleTool('p1').execute!({ title: 'New' }, ctx)) as string;
      expect(r).toMatch(/Renamed project to "New"/);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.method).toBe('GET');
      expect(calls[1]?.method).toBe('PATCH');
      expect(calls[1]?.body).toEqual({ name: 'New' });
    });

    it('renames when current name is "Design System" (treated as placeholder)', async () => {
      const calls = installFetchSequence([
        { body: { id: 'p1', name: 'Design System' } },
        { body: { id: 'p1', name: 'My DS' } },
      ]);
      const r = (await setProjectTitleTool('p1').execute!({ title: 'My DS' }, ctx)) as string;
      expect(r).toMatch(/Renamed project to "My DS"/);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.method).toBe('PATCH');
    });

    it('no-ops when project already has a non-placeholder name', async () => {
      const calls = installFetchSequence([{ body: { id: 'p1', name: 'My App' } }]);
      const r = (await setProjectTitleTool('p1').execute!({ title: 'Other' }, ctx)) as string;
      expect(r).toMatch(/already named "My App"/);
      expect(r).toMatch(/leaving as-is/);
      // No PATCH issued.
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('GET');
    });

    it('treats current name with leading/trailing whitespace as the trimmed value', async () => {
      // "  Design System  " trimmed = "Design System" = placeholder → rename.
      const calls = installFetchSequence([
        { body: { id: 'p1', name: '  Design System  ' } },
        { body: { id: 'p1', name: 'X' } },
      ]);
      const r = (await setProjectTitleTool('p1').execute!({ title: 'X' }, ctx)) as string;
      expect(r).toMatch(/Renamed project to "X"/);
      expect(calls).toHaveLength(2);
    });
  });

  it('returns error string when GET fails', async () => {
    installFetchSequence([{ status: 500, body: { error: 'boom' } }]);
    const r = (await setProjectTitleTool('p1').execute!({ title: 'x' }, ctx)) as string;
    expect(r).toMatch(/error/i);
    expect(r).toMatch(/500/);
  });

  it('returns error string when PATCH fails', async () => {
    installFetchSequence([
      { body: { id: 'p1', name: '' } },
      { status: 500, body: { error: 'boom' } },
    ]);
    const r = (await setProjectTitleTool('p1').execute!({ title: 'x' }, ctx)) as string;
    expect(r).toMatch(/error/i);
    expect(r).toMatch(/500/);
  });
});
