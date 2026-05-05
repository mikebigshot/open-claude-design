import { describe, expect, it } from 'vitest';
import { SkillFrontmatterV1 } from '../schema';

describe('SkillFrontmatterV1', () => {
  it('accepts minimal frontmatter (name + description)', () => {
    const r = SkillFrontmatterV1.safeParse({ name: 'wireframe', description: 'low-fi sketches' });
    expect(r.success).toBe(true);
  });
  it('defaults trigger.keywords to empty array', () => {
    const r = SkillFrontmatterV1.safeParse({ name: 'x', description: 'y' });
    expect(r.success && r.data.trigger.keywords).toEqual([]);
  });
  it('rejects missing name', () => {
    const r = SkillFrontmatterV1.safeParse({ description: 'y' });
    expect(r.success).toBe(false);
  });
});
