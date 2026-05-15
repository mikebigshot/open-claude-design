// invoke_skill — load a registered skill's prompt into context by name.
//
// Matches case-insensitively against either the skill's id (registry key)
// OR its frontmatter `name`. Returns the skill's prompt as a bare string
// (no `{ok, content}` wrapper) so the LLM treats it as text content.
// Unknown skill returns a friendly  `Unknown skill "X". Available skills:
// A, B, …` string so the model can self-correct without orchestration.

import { tool } from 'ai';
import { z } from 'zod';
import type { ParsedSkill } from '@/skills/registry.js';

export interface InvokeSkillContext {
  skills: Record<string, ParsedSkill>;
}

function findSkill(
  skills: Record<string, ParsedSkill>,
  query: string,
): ParsedSkill | undefined {
  const lower = query.toLowerCase();
  for (const [id, skill] of Object.entries(skills)) {
    if (id.toLowerCase() === lower) return skill;
    if (skill.frontmatter?.name?.toLowerCase() === lower) return skill;
  }
  return undefined;
}

function renderBody(skill: ParsedSkill): string {
  const refs = skill.references
    .map((r) => `## reference: ${r.path}\n\n\`\`\`\n${r.content}\n\`\`\``)
    .join('\n\n');
  return refs ? `${skill.body}\n\n${refs}` : skill.body;
}

export function invokeSkillTool(ctx: InvokeSkillContext) {
  return tool({
    description:
      "Invoke a built-in skill by name. Returns the skill's full prompt so you can follow its instructions. Use this when the user asks for something that matches a skill you know about but whose prompt is not already in context.",
    inputSchema: z
      .object({
        name: z
          .string()
          .describe('The skill name (case-insensitive — matches either id or frontmatter name).'),
      })
      .strict(),
    execute: async ({ name }) => {
      const trimmed = String(name ?? '').trim();
      const skill = trimmed ? findSkill(ctx.skills, trimmed) : undefined;
      if (skill) return renderBody(skill);
      const available = Object.keys(ctx.skills).join(', ');
      return `Unknown skill "${trimmed}". Available skills: ${available}`;
    },
  });
}
