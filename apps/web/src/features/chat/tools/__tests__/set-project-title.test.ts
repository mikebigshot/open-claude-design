// set_project_title — PATCH wrapper.

import { describe, expect, it } from 'vitest';
import { setProjectTitleTool } from '../set-project-title';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('set_project_title', () => {
  it('rejects empty title', () => {
    const t = setProjectTitleTool('p1');
    expect(asSchema(t.inputSchema)?.safeParse({ title: '' }).success).toBe(false);
  });

  it('rejects title >120 chars', () => {
    const t = setProjectTitleTool('p1');
    expect(asSchema(t.inputSchema)?.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
  });

  it('PATCHes /api/projects/:id with {name} body', async () => {
    let calledUrl = '';
    let method = '';
    let body: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      method = init?.method ?? '';
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'p1', name: 'New' }), { status: 200 });
    }) as typeof fetch;

    const r = (await setProjectTitleTool('p1').execute!({ title: 'New' }, ctx)) as string;
    expect(calledUrl).toBe('/api/projects/p1');
    expect(method).toBe('PATCH');
    expect(body).toEqual({ name: 'New' });
    expect(r).toMatch(/Renamed project to "New"/);
  });

  it('returns error string on non-ok', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    const r = (await setProjectTitleTool('p1').execute!({ title: 'x' }, ctx)) as string;
    expect(r).toMatch(/error/i);
    expect(r).toMatch(/500/);
  });
});
