// invoke_skill — case-insensitive name match, returns bare string for the
// LLM (drops the {ok, content} wrapper). Unknown skills return a friendly
// "Unknown skill ...; Available: ..." string so the LLM can self-correct.

import { describe, expect, it } from 'vitest';
import { invokeSkillTool } from '../invoke-skill';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

const fakeSkills = {
  wireframe: {
    id: 'wireframe',
    frontmatter: {
      name: 'Wireframe',
      description: '...',
      trigger: { keywords: [] },
      od: { mode: 'wireframe' as const, preview: { type: 'jsx' as const, entry: 'App.jsx' } },
      references: [],
    },
    body: 'Use grayscale boxes.\n',
    references: [{ path: 'tips.md', content: 'be quick' }],
  },
  'make-a-deck': {
    id: 'make-a-deck',
    frontmatter: {
      name: 'Make a Deck',
      description: '...',
      trigger: { keywords: [] },
      od: { mode: 'highfi' as const, preview: { type: 'jsx' as const, entry: 'App.jsx' } },
      references: [],
    },
    body: 'Build a slide deck.\n',
    references: [],
  },
};

describe('invoke_skill', () => {
  it('returns bare string with body + inlined references for known skill (exact id)', async () => {
    const t = invokeSkillTool({ skills: fakeSkills as never });
    const r = (await t.execute!({ name: 'wireframe' }, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('Use grayscale boxes.');
    expect(r).toContain('reference: tips.md');
    expect(r).toContain('be quick');
  });

  it('matches case-insensitively against skill id', async () => {
    const t = invokeSkillTool({ skills: fakeSkills as never });
    const r = (await t.execute!({ name: 'WireFrame' }, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('Use grayscale boxes.');
  });

  it('matches case-insensitively against frontmatter name (e.g. "Make a Deck")', async () => {
    const t = invokeSkillTool({ skills: fakeSkills as never });
    const r = (await t.execute!({ name: 'make a deck' }, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('Build a slide deck.');
  });

  it('trims whitespace from input name before matching', async () => {
    const t = invokeSkillTool({ skills: fakeSkills as never });
    const r = (await t.execute!({ name: '  wireframe  ' }, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toContain('Use grayscale boxes.');
  });

  it('returns friendly "Unknown skill ..." string with available names for misses', async () => {
    const t = invokeSkillTool({ skills: fakeSkills as never });
    const r = (await t.execute!({ name: 'nope' }, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toMatch(/unknown skill/i);
    expect(r).toContain('"nope"');
    expect(r).toContain('wireframe');
    expect(r).toContain('make-a-deck');
  });

  it('empty input name returns the unknown-skill message (not a crash)', async () => {
    const t = invokeSkillTool({ skills: fakeSkills as never });
    const r = (await t.execute!({ name: '' }, ctx)) as string;
    expect(typeof r).toBe('string');
    expect(r).toMatch(/unknown skill/i);
  });
});
