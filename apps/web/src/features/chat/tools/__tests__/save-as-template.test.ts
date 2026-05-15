import { describe, expect, it } from 'vitest';
import { saveAsTemplateTool } from '../save-as-template';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('save_as_template', () => {
  it('rejects empty name', () => {
    const t = saveAsTemplateTool('p');
    expect(asSchema(t.inputSchema)?.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects name >120 chars', () => {
    const t = saveAsTemplateTool('p');
    expect(asSchema(t.inputSchema)?.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
  });

  it('POSTs name + description', async () => {
    let body: unknown;
    globalThis.fetch = (async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ templateId: 'abc123', fileCount: 7 }), { status: 200 });
    }) as typeof fetch;
    const r = (await saveAsTemplateTool('p1').execute!(
      { name: 'Landing kit', description: 'Modern landing pages' },
      ctx,
    )) as string;
    expect(body).toEqual({ name: 'Landing kit', description: 'Modern landing pages' });
    expect(r).toMatch(/Saved as template "Landing kit"/);
    expect(r).toMatch(/id=abc123/);
    expect(r).toMatch(/7 files snapshotted/);
  });

  describe('intro_text (composer intro for new projects from this template)', () => {
    it('schema accepts intro_text up to 1000 chars', () => {
      const t = saveAsTemplateTool('p');
      expect(
        asSchema(t.inputSchema)?.safeParse({ name: 'N', intro_text: 'hello' }).success,
      ).toBe(true);
      expect(
        asSchema(t.inputSchema)?.safeParse({ name: 'N', intro_text: 'x'.repeat(1001) }).success,
      ).toBe(false);
    });

    it('forwards intro_text in POST body when provided', async () => {
      let body: unknown;
      globalThis.fetch = (async (_u, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ templateId: 't', fileCount: 1 }), { status: 200 });
      }) as typeof fetch;
      await saveAsTemplateTool('p1').execute!(
        {
          name: 'Quiz kit',
          description: 'Quiz starter',
          intro_text: 'Tell me what the quiz is about and I will scaffold it.',
        },
        ctx,
      );
      expect(body).toEqual({
        name: 'Quiz kit',
        description: 'Quiz starter',
        intro_text: 'Tell me what the quiz is about and I will scaffold it.',
      });
    });

    it('omits intro_text key from POST body when not provided', async () => {
      let body: Record<string, unknown> | undefined;
      globalThis.fetch = (async (_u, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ templateId: 't', fileCount: 1 }), { status: 200 });
      }) as typeof fetch;
      await saveAsTemplateTool('p1').execute!({ name: 'X' }, ctx);
      expect(body).toEqual({ name: 'X' });
      expect('intro_text' in (body ?? {})).toBe(false);
    });
  });

  it('returns error string on 400', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'project has no files to snapshot' }), {
        status: 400,
      })) as typeof fetch;
    const r = (await saveAsTemplateTool('p1').execute!({ name: 'x' }, ctx)) as string;
    expect(r).toMatch(/error/i);
    expect(r).toMatch(/no files/);
  });
});
