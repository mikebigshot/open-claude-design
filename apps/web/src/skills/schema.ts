import { z } from 'zod';

export const SkillFrontmatterV1 = z.object({
  name: z.string(),
  description: z.string(),
  /**
   * v2 capture (research/claude-design-v2/05-skills-system.md): some skills
   * (typically org-level customs) carry hidden:true so they don't appear in
   * the public skill list. invoke_skill must still resolve them by name —
   * use getSkillByName / getSkill, NOT listSkills(), for that path.
   */
  hidden: z.boolean().default(false),
  trigger: z.object({ keywords: z.array(z.string()).default([]) }).default({ keywords: [] }),
  od: z
    .object({
      mode: z.enum(['design', 'deck', 'prototype', 'wireframe', 'animation']).default('design'),
      fidelity_default: z.enum(['wireframe', 'high']).optional(),
      preview: z
        .object({
          type: z.enum(['jsx', 'html']).default('jsx'),
          entry: z.string().default('App.jsx'),
        })
        .default({ type: 'jsx', entry: 'App.jsx' }),
    })
    .default({ mode: 'design', preview: { type: 'jsx', entry: 'App.jsx' } }),
  references: z.array(z.string()).default([]),
});

export type SkillFrontmatterV1 = z.infer<typeof SkillFrontmatterV1>;
