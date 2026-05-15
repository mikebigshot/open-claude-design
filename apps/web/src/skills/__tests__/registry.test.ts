import { describe, expect, it } from 'vitest';
import { getSkillByName, listSkills, parseSkillMarkdown, SKILLS } from '../registry';

const SAMPLE = `---
name: slide-deck
description: Multi-page slide deck
trigger:
  keywords: [deck, slides]
od:
  mode: deck
references:
  - template.jsx
---
Body line 1.

Body line 2.`;

describe('parseSkillMarkdown', () => {
  it('parses frontmatter and body separately', () => {
    const skill = parseSkillMarkdown(SAMPLE, 'slide-deck');
    expect(skill.frontmatter.name).toBe('slide-deck');
    expect(skill.frontmatter.trigger.keywords).toEqual(['deck', 'slides']);
    expect(skill.frontmatter.od.mode).toBe('deck');
    expect(skill.body.trim().startsWith('Body line 1.')).toBe(true);
  });

  it('parses hidden:true from frontmatter', () => {
    const HIDDEN = `---
name: secret-skill
description: org-only
hidden: true
---
Secret body.`;
    const skill = parseSkillMarkdown(HIDDEN, 'secret-skill');
    expect(skill.frontmatter.hidden).toBe(true);
  });

  it('defaults hidden=false when frontmatter omits the field', () => {
    const skill = parseSkillMarkdown(SAMPLE, 'slide-deck');
    expect(skill.frontmatter.hidden).toBe(false);
  });
});

describe('built-in registry (loaded via Vite glob)', () => {
  it('frontend-design loads', () => {
    expect(SKILLS['frontend-design']?.frontmatter.name).toBe('Frontend design');
  });
  it('wireframe loads', () => {
    expect(SKILLS['wireframe']?.frontmatter.name).toBe('Wireframe');
  });
  it('slide-deck loads with template.jsx reference', () => {
    expect(SKILLS['slide-deck']?.frontmatter.name).toBe('Make a deck');
    const refs = SKILLS['slide-deck']?.references ?? [];
    expect(refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'template.jsx' })]),
    );
  });
  it('interactive-prototype loads with router-example.jsx reference', () => {
    expect(SKILLS['interactive-prototype']?.frontmatter.name).toBe('Interactive prototype');
    const refs = SKILLS['interactive-prototype']?.references ?? [];
    expect(refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'router-example.jsx' })]),
    );
  });

  // ── listSkills hidden filter (master spec §4.4) ────────────────────────
  // None of our 4 OSS built-ins are hidden, so listSkills() must return
  // every entry in SKILLS by default. The includeHidden:true switch is
  // there for invoke_skill / org-customs paths.
  it('listSkills() default: returns every visible skill (none of ours are hidden)', () => {
    const visible = listSkills();
    expect(visible.length).toBe(Object.keys(SKILLS).length);
    for (const skill of visible) {
      expect(skill.frontmatter.hidden).toBe(false);
    }
  });

  it('listSkills({includeHidden:true}) returns every skill (visible + hidden)', () => {
    const all = listSkills({ includeHidden: true });
    expect(all.length).toBe(Object.keys(SKILLS).length);
  });
});

// ── getSkillByName (master spec §4.4) ───────────────────────────────────
// Lookup-by-display-name is what the v2 attachment protocol needs:
// <skill-attachment name="Make a deck">…</skill-attachment> arrives keyed
// by the user-facing name, not the registry id (`slide-deck`).
// Case-insensitive match; falls back to id-based lookup if name doesn't
// resolve. Hidden skills MUST be findable here (otherwise org-customs are
// unreachable).
describe('getSkillByName', () => {
  it('returns a skill matched by frontmatter name (exact case)', () => {
    expect(getSkillByName('Frontend design')?.frontmatter.name).toBe('Frontend design');
    expect(getSkillByName('Wireframe')?.frontmatter.name).toBe('Wireframe');
    expect(getSkillByName('Make a deck')?.frontmatter.name).toBe('Make a deck');
    expect(getSkillByName('Interactive prototype')?.frontmatter.name).toBe('Interactive prototype');
  });

  it('matches by name case-insensitively', () => {
    expect(getSkillByName('frontend design')?.frontmatter.name).toBe('Frontend design');
    expect(getSkillByName('FRONTEND DESIGN')?.frontmatter.name).toBe('Frontend design');
    expect(getSkillByName('Make a Deck')?.frontmatter.name).toBe('Make a deck');
  });

  it('returns undefined for an unknown name', () => {
    expect(getSkillByName('does-not-exist')).toBeUndefined();
    expect(getSkillByName('')).toBeUndefined();
  });

  it('falls back to id-based lookup when the name does not match (so registry ids still resolve)', () => {
    // 'frontend-design' is the registry id; the frontmatter name is
    // 'Frontend design'. After the case-insensitive name pass fails,
    // we look up by id and still return the skill.
    expect(getSkillByName('frontend-design')?.frontmatter.name).toBe('Frontend design');
    expect(getSkillByName('slide-deck')?.frontmatter.name).toBe('Make a deck');
  });
});
