import { describe, expect, it } from 'vitest';
import { makeTools } from './index';
import { SKILLS } from '@/skills/registry';

describe('makeTools — 14-tool surface (Phase 1 + verifier)', () => {
  it('exposes exactly the 14 expected tool names', () => {
    const tools = makeTools({
      projectId: 'p_test',
      skills: SKILLS,
      onTodosUpdate: () => {},
    });
    expect(Object.keys(tools).sort()).toEqual([
      'copy_files',
      'delete_file',
      'done',
      'fork_verifier_agent',
      'grep',
      'invoke_skill',
      'list_files',
      'read_file',
      'str_replace_based_edit_tool',
      'update_todos',
      'verification_feedback',
      'view_image',
      'web_fetch',
      'write_file',
    ]);
  });

  it('every tool has a non-empty description and inputSchema', () => {
    const tools = makeTools({ projectId: 'p_test', skills: SKILLS, onTodosUpdate: () => {} });
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name}.description`).toBeTruthy();
      expect((t as { inputSchema?: unknown }).inputSchema, `${name}.inputSchema`).toBeTruthy();
    }
  });
});
