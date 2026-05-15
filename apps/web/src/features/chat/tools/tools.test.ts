// makeTools — agent v2 alignment. Mode-gated tool surface:
//   - main mode (default): 14 baseline + snip + questions_v2 + register_assets
//                          + open_for_print + present_fs_item_for_download
//                          + gen_pptx + super_inline_html
//                          + eval_js_user_view + screenshot_user_view = 23 tools
//   - verifier mode: 14 baseline + snip + questions_v2 + register_assets
//                    + open_for_print + present_fs_item_for_download
//                    + gen_pptx + super_inline_html + eval_js + screenshot
//                    + get_webview_logs + multi_screenshot = 25 tools
//
// Verifier-only and main-only tools never overlap. `open_for_print`,
// `present_fs_item_for_download`, `gen_pptx`, and `super_inline_html`
// (research/claude-design-v2 §13) are universal — both surfaces export
// artifacts to the user.

import { describe, expect, it } from 'vitest';
import { makeTools } from './index';
import { SKILLS } from '@/skills/registry';

const baseCtx = {
  projectId: 'p_test',
  skills: SKILLS,
  onTodosUpdate: () => {},
  getChatId: () => 'c_test',
};

describe('makeTools — agent v2 alignment surface', () => {
  it('main mode (default) exposes the 23 expected tools', () => {
    const tools = makeTools(baseCtx);
    expect(Object.keys(tools).sort()).toEqual([
      'copy_files',
      'delete_file',
      'done',
      'eval_js_user_view',
      'fork_verifier_agent',
      'gen_pptx',
      'grep',
      'invoke_skill',
      'list_files',
      'open_for_print',
      'present_fs_item_for_download',
      'questions_v2',
      'read_file',
      'register_assets',
      'screenshot_user_view',
      'snip',
      'str_replace_based_edit_tool',
      'super_inline_html',
      'update_todos',
      'verification_feedback',
      'view_image',
      'web_fetch',
      'write_file',
    ]);
  });

  it('verifier mode exposes the 25 expected tools (verifier-only set, no user-view siblings)', () => {
    const tools = makeTools({ ...baseCtx, mode: 'verifier' });
    expect(Object.keys(tools).sort()).toEqual([
      'copy_files',
      'delete_file',
      'done',
      'eval_js',
      'fork_verifier_agent',
      'gen_pptx',
      'get_webview_logs',
      'grep',
      'invoke_skill',
      'list_files',
      'multi_screenshot',
      'open_for_print',
      'present_fs_item_for_download',
      'questions_v2',
      'read_file',
      'register_assets',
      'screenshot',
      'snip',
      'str_replace_based_edit_tool',
      'super_inline_html',
      'update_todos',
      'verification_feedback',
      'view_image',
      'web_fetch',
      'write_file',
    ]);
  });

  it('verifier-only and main-only sets never overlap', () => {
    const main = new Set(Object.keys(makeTools(baseCtx)));
    const verifier = new Set(Object.keys(makeTools({ ...baseCtx, mode: 'verifier' })));
    const verifierOnly = [...verifier].filter((k) => !main.has(k));
    const mainOnly = [...main].filter((k) => !verifier.has(k));
    expect(verifierOnly.sort()).toEqual([
      'eval_js',
      'get_webview_logs',
      'multi_screenshot',
      'screenshot',
    ]);
    expect(mainOnly.sort()).toEqual(['eval_js_user_view', 'screenshot_user_view']);
  });

  it('every tool has a non-empty description and inputSchema (main)', () => {
    const tools = makeTools(baseCtx);
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name}.description`).toBeTruthy();
      expect((t as { inputSchema?: unknown }).inputSchema, `${name}.inputSchema`).toBeTruthy();
    }
  });

  it('every tool has a non-empty description and inputSchema (verifier)', () => {
    const tools = makeTools({ ...baseCtx, mode: 'verifier' });
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name}.description`).toBeTruthy();
      expect((t as { inputSchema?: unknown }).inputSchema, `${name}.inputSchema`).toBeTruthy();
    }
  });

  it('default mode is main when not specified', () => {
    const tools = makeTools(baseCtx);
    expect(Object.keys(tools)).toContain('eval_js_user_view');
    expect(Object.keys(tools)).not.toContain('eval_js');
  });

  it('getChatId is optional; falls back to a default when omitted', () => {
    // The {getChatId} option is not strictly required for tools that don't
    // depend on chat id at execute time. snip uses it; calling makeTools
    // without it should still produce a registerable surface.
    const tools = makeTools({
      projectId: 'p_test',
      skills: SKILLS,
      onTodosUpdate: () => {},
    });
    expect(tools.snip).toBeTruthy();
  });
});
