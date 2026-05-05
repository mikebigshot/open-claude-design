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
};

describe('invoke_skill', () => {
  it('returns body + inlined references for known skill', async () => {
    const t = invokeSkillTool({ skills: fakeSkills as never });
    const r = (await t.execute!({ name: 'wireframe' }, ctx)) as
      | { ok: false; error: string; available: string[] }
      | { ok: true; content: string };
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain('Use grayscale boxes.');
      expect(r.content).toContain('reference: tips.md');
      expect(r.content).toContain('be quick');
    }
  });
  it('returns error + available list for unknown skill', async () => {
    const t = invokeSkillTool({ skills: fakeSkills as never });
    const r = await t.execute!({ name: 'nope' }, ctx);
    expect(r).toMatchObject({ ok: false, error: 'unknown_skill', available: ['wireframe'] });
  });
});
