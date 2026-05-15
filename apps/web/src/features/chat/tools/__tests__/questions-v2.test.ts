// Tests for questions_v2 — structured questionnaire surface. The tool is a
// signal-only execute (it returns a sentinel string telling the agent to end
// its turn); the actual UI rendering is QuestionsForm.tsx.

import { describe, expect, it } from 'vitest';

import { QuestionsV2Input, questionsV2Tool } from '../questions-v2';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('questions_v2', () => {
  it('returns the sentinel string to signal "end your turn, wait for the user"', async () => {
    const r = await questionsV2Tool().execute!(
      {
        title: 'Quick questions about the landing page',
        questions: [{ id: 'audience', kind: 'text-options', title: 'Who is this for?' }],
      },
      ctx,
    );
    expect(r).toBe('Questions sent. End your turn to let the user answer.');
  });

  it('parses a text-options question with multi=true', () => {
    const parsed = QuestionsV2Input.parse({
      title: 'X',
      questions: [
        {
          id: 'features',
          kind: 'text-options',
          title: 'Pick features',
          options: ['Auth', 'Dark mode', 'Realtime'],
          multi: true,
        },
      ],
    });
    expect(parsed.questions[0]?.kind).toBe('text-options');
    expect(parsed.questions[0]?.multi).toBe(true);
    expect(parsed.questions[0]?.options).toEqual(['Auth', 'Dark mode', 'Realtime']);
  });

  it('parses an svg-options question (options are inline SVG strings)', () => {
    const parsed = QuestionsV2Input.parse({
      title: 'Layout',
      questions: [
        {
          id: 'layout',
          kind: 'svg-options',
          title: 'Pick a layout',
          options: [
            '<svg viewBox="0 0 80 56"><rect/></svg>',
            '<svg viewBox="0 0 80 56"><circle/></svg>',
          ],
        },
      ],
    });
    expect(parsed.questions[0]?.kind).toBe('svg-options');
    expect(parsed.questions[0]?.options?.[0]).toContain('<svg');
  });

  it('parses a slider question with min/max/step/default', () => {
    const parsed = QuestionsV2Input.parse({
      title: 'Density',
      questions: [
        {
          id: 'density',
          kind: 'slider',
          title: 'Density',
          min: 0,
          max: 100,
          step: 5,
          default: 50,
        },
      ],
    });
    const q = parsed.questions[0];
    if (q?.kind === 'slider') {
      expect(q.min).toBe(0);
      expect(q.max).toBe(100);
      expect(q.step).toBe(5);
      expect(q.default).toBe(50);
    } else throw new Error('expected slider');
  });

  it('parses a file question with accept', () => {
    const parsed = QuestionsV2Input.parse({
      title: 'Logo',
      questions: [{ id: 'logo', kind: 'file', title: 'Upload logo', accept: 'image/*' }],
    });
    expect(parsed.questions[0]?.kind).toBe('file');
    expect(parsed.questions[0]?.accept).toBe('image/*');
  });

  it('parses a freeform question', () => {
    const parsed = QuestionsV2Input.parse({
      title: 'Notes',
      questions: [{ id: 'notes', kind: 'freeform', title: 'Anything else?' }],
    });
    expect(parsed.questions[0]?.kind).toBe('freeform');
  });

  it('rejects an unknown kind value', () => {
    expect(() =>
      QuestionsV2Input.parse({
        title: 'X',
        questions: [{ id: 'q', kind: 'unsupported', title: 'X' }],
      }),
    ).toThrow();
  });

  it('rejects when required fields missing (no title at top level)', () => {
    expect(() => QuestionsV2Input.parse({ questions: [] })).toThrow();
  });

  it('rejects when a question is missing id/kind/title', () => {
    expect(() =>
      QuestionsV2Input.parse({ title: 'X', questions: [{ kind: 'freeform', title: 'X' }] }),
    ).toThrow();
  });

  it('description references the 5 question kinds', () => {
    const t = questionsV2Tool();
    expect(t.description).toContain('text-options');
    expect(t.description).toContain('svg-options');
    expect(t.description).toContain('slider');
    expect(t.description).toContain('file');
    expect(t.description).toContain('freeform');
  });

  it('does not perform any network I/O', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('', { status: 200 });
    }) as typeof fetch;
    await questionsV2Tool().execute!(
      { title: 'X', questions: [{ id: 'q', kind: 'freeform', title: 'X' }] },
      ctx,
    );
    expect(fetchCalled).toBe(false);
  });

  describe('questions-v2-show CustomEvent dispatch', () => {
    it('dispatches a `questions-v2-show` CustomEvent with the spec', async () => {
      interface ShowDetail {
        spec: { title: string; questions: unknown[] };
      }
      const events: ShowDetail[] = [];
      const handler = (e: Event) =>
        events.push((e as CustomEvent<ShowDetail>).detail);
      window.addEventListener('questions-v2-show', handler as EventListener);

      await questionsV2Tool().execute!(
        {
          title: 'Quick questions',
          questions: [{ id: 'audience', kind: 'text-options', title: 'Who is this for?' }],
        },
        ctx,
      );

      window.removeEventListener('questions-v2-show', handler as EventListener);
      expect(events).toHaveLength(1);
      expect(events[0]?.spec.title).toBe('Quick questions');
      expect(events[0]?.spec.questions).toHaveLength(1);
    });
  });
});
