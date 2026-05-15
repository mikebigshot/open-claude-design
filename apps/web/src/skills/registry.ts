import { parse as parseYaml } from 'yaml';
import { SkillFrontmatterV1 } from './schema.js';

export interface ParsedSkill {
  id: string;
  frontmatter: SkillFrontmatterV1;
  body: string;
  references: { path: string; content: string }[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function splitFrontmatter(raw: string): { data: unknown; content: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { data: {}, content: raw };
  return { data: parseYaml(m[1]!) ?? {}, content: m[2] ?? '' };
}

export function parseSkillMarkdown(
  raw: string,
  id: string,
  references: { path: string; content: string }[] = [],
): ParsedSkill {
  const { data, content } = splitFrontmatter(raw);
  const frontmatter = SkillFrontmatterV1.parse(data);
  return { id, frontmatter, body: content, references };
}

// --- registry: Vite glob loaders (build-time) ---
const skillFiles = import.meta.glob<string>('./built-in/**/SKILL.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const referenceFiles = import.meta.glob<string>('./built-in/**/references/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function buildRegistry(): Record<string, ParsedSkill> {
  const out: Record<string, ParsedSkill> = {};
  for (const [path, raw] of Object.entries(skillFiles)) {
    const m = path.match(/\.\/built-in\/([^/]+)\/SKILL\.md$/);
    if (!m) continue;
    const id = m[1]!;
    const refs: { path: string; content: string }[] = [];
    for (const [refPath, refRaw] of Object.entries(referenceFiles)) {
      const rm = refPath.match(new RegExp(`^\\./built-in/${id}/references/(.+)$`));
      if (rm) refs.push({ path: rm[1]!, content: refRaw });
    }
    out[id] = parseSkillMarkdown(raw, id, refs);
  }
  return out;
}

export const SKILLS: Record<string, ParsedSkill> = buildRegistry();

export interface ListSkillsOptions {
  /**
   * Default false. When false, skills with `hidden: true` in their
   * frontmatter are filtered out — keeps them off the user-facing skill
   * list / system-prompt bullets. invoke_skill must use {includeHidden:
   * true} (or `getSkillByName` / `getSkill`) to keep org-level customs
   * reachable.
   */
  includeHidden?: boolean;
}

export function listSkills(opts: ListSkillsOptions = {}): ParsedSkill[] {
  const all = Object.values(SKILLS);
  if (opts.includeHidden) return all;
  return all.filter((s) => !s.frontmatter.hidden);
}

export function getSkill(name: string): ParsedSkill | undefined {
  return SKILLS[name];
}

/**
 * Lookup a skill by its frontmatter `name` (the user-facing label)
 * case-insensitively, falling back to id-based lookup if the name doesn't
 * match. Always considers hidden skills — invoke_skill and the v2
 * `<skill-attachment name="…">` resolver need to find them even when
 * listSkills() filters them from the public list.
 *
 * Owned by W3; consumed by W2's invoke_skill tool resolution and W1's
 * sendMessage attachment-content lookup.
 */
export function getSkillByName(name: string): ParsedSkill | undefined {
  if (!name) return undefined;
  const target = name.toLowerCase();
  for (const skill of Object.values(SKILLS)) {
    if (skill.frontmatter.name.toLowerCase() === target) return skill;
  }
  return SKILLS[name];
}
