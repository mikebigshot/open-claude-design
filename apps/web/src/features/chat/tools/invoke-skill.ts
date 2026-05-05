import { tool } from 'ai';
import { z } from 'zod';
import type { ParsedSkill } from '@/skills/registry.js';

export interface InvokeSkillContext {
  skills: Record<string, ParsedSkill>;
}

export function invokeSkillTool(ctx: InvokeSkillContext) {
  return tool({
    description:
      'Load a built-in skill into your context. Call when the user asks for something matching one of your Available Skills (see system prompt block 2).',
    inputSchema: z.object({ name: z.string().describe('Skill id (e.g. "wireframe").') }),
    execute: async ({ name }) => {
      const skill = ctx.skills[name];
      if (!skill) {
        return {
          ok: false as const,
          error: 'unknown_skill' as const,
          available: Object.keys(ctx.skills),
        };
      }
      const refs = skill.references
        .map((r) => `## reference: ${r.path}\n\n\`\`\`\n${r.content}\n\`\`\``)
        .join('\n\n');
      const content = refs ? `${skill.body}\n\n${refs}` : skill.body;
      return { ok: true as const, content };
    },
  });
}
