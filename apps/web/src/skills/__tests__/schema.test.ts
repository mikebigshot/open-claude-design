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

  // ── hidden flag (master spec §4.4) ──────────────────────────────────
  // v2 has skills with hidden:true that should not appear in the public
  // skill list / system-prompt bullets. invoke_skill must still be able
  // to resolve them by name (otherwise org-level customs are unreachable).
  it('accepts an optional hidden=true flag in frontmatter', () => {
    const r = SkillFrontmatterV1.safeParse({
      name: 'x',
      description: 'y',
      hidden: true,
    });
    expect(r.success && r.data.hidden).toBe(true);
  });

  it('defaults hidden to false when the field is omitted', () => {
    const r = SkillFrontmatterV1.safeParse({ name: 'x', description: 'y' });
    expect(r.success && r.data.hidden).toBe(false);
  });
});
