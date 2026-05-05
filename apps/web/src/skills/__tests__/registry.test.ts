import { describe, expect, it } from 'vitest';
import { parseSkillMarkdown, SKILLS } from '../registry';

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
});
