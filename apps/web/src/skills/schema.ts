import { z } from 'zod';

export const SkillFrontmatterV1 = z.object({
  name: z.string(),
  description: z.string(),
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
