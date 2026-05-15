// copy_starter_component — built-in starter library.

import { describe, expect, it } from 'vitest';
import { copyStarterComponentTool, STARTER_REGISTRY } from '../copy-starter-component';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('copy_starter_component', () => {
  it('description enumerates starter names', () => {
    const t = copyStarterComponentTool('p');
    const desc = String(t.description);
    for (const n of Object.keys(STARTER_REGISTRY)) {
      expect(desc).toContain(n);
    }
  });

  it('rejects unknown starter name via enum', () => {
    const t = copyStarterComponentTool('p');
    expect(
      asSchema(t.inputSchema)?.safeParse({ name: 'unknown', dest: 'a.jsx' }).success,
    ).toBe(false);
  });

  it('accepts a known starter + dest', () => {
    const t = copyStarterComponentTool('p');
    expect(
      asSchema(t.inputSchema)?.safeParse({ name: 'ios_frame', dest: 'components/IFrame.jsx' })
        .success,
    ).toBe(true);
  });

  it('PUTs the starter content to the project', async () => {
    let body: { content: string } | undefined;
    let calledUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input);
      body = JSON.parse(String(init?.body)) as { content: string };
      return new Response(JSON.stringify({ sha256: 'a', size: 1 }), { status: 200 });
    }) as typeof fetch;

    const r = (await copyStarterComponentTool('p1').execute!(
      { name: 'design_canvas', dest: 'Canvas.jsx' },
      ctx,
    )) as string;
    expect(calledUrl).toBe('/api/projects/p1/files/Canvas.jsx');
    expect(body?.content).toContain('DesignCanvas');
    expect(r).toMatch(/Copied starter "design_canvas" → Canvas\.jsx/);
  });

  it('returns error string on non-ok', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    const r = (await copyStarterComponentTool('p1').execute!(
      { name: 'ios_frame', dest: 'a.jsx' },
      ctx,
    )) as string;
    expect(r).toMatch(/error/i);
  });
});
