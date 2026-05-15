import { describe, expect, it } from 'vitest';
import { BLOCK_1 } from '../block-1';

// Block-1 is the verbatim designer prompt. Snapshot would be unwieldy at
// 30+ KB, so we assert a tight set of structural invariants:
//   1. Each major v1 section is still there (no accidental delete).
//   2. The targeted v2 deltas we wanted to add are present.
//   3. No reference to tools / SDK / CDN we don't ship slipped in
//      (surgical-removal policy — see master spec §4.1 + §5 of the
//      2026-05-02 prior spec).
describe('BLOCK_1 (system-prompt block-1)', () => {
  // ── v1 anchors that must survive future edits ──────────────────────────
  it('keeps the workflow header', () => {
    expect(BLOCK_1).toContain('## Your workflow');
  });
  it('keeps the React + Babel pinned-version section', () => {
    expect(BLOCK_1).toContain('react@18.3.1/umd/react.development.js');
    expect(BLOCK_1).toContain('@babel/standalone@7.29.0/babel.min.js');
  });
  it('keeps the Tweaks protocol literals', () => {
    expect(BLOCK_1).toContain('__activate_edit_mode');
    expect(BLOCK_1).toContain('__deactivate_edit_mode');
    expect(BLOCK_1).toContain('__edit_mode_available');
    expect(BLOCK_1).toContain('__edit_mode_set_keys');
    expect(BLOCK_1).toContain('EDITMODE-BEGIN');
  });
  it('keeps the questions_v2 guidance', () => {
    expect(BLOCK_1).toContain('questions_v2');
    expect(BLOCK_1).toContain('questions_v2 does not return an answer immediately');
  });
  it('keeps the cross-project / file-paths guidance', () => {
    expect(BLOCK_1).toContain('## File paths');
    expect(BLOCK_1).toContain('/projects/');
  });
  it('keeps the speaker-notes section', () => {
    expect(BLOCK_1).toContain('speaker-notes');
  });

  // ── v2 deltas we are adding ────────────────────────────────────────────
  it('includes the v2 data-comment-anchor preservation paragraph', () => {
    expect(BLOCK_1).toContain('data-comment-anchor');
    expect(BLOCK_1).toContain('Preserving comment anchors');
  });
  it('includes the v2 __om-edit-overrides style-block guidance', () => {
    expect(BLOCK_1).toContain('__om-edit-overrides');
    expect(BLOCK_1).toContain('!important');
  });
  it('includes the v2 context-management snip guidance (paired with snip tool from W2)', () => {
    expect(BLOCK_1).toContain('## Context management');
    expect(BLOCK_1).toContain('[id:mNNNN]');
    expect(BLOCK_1).toContain('snip');
    expect(BLOCK_1).toContain('Snip silently as you work');
  });

  // ── surgical-removal policy: nothing about tools / SDKs we don't ship ─
  it('does NOT reference unimplemented tools (surgical-removal policy)', () => {
    // Tools we do not ship — must stay removed even if v2 verbatim
    // references them.
    expect(BLOCK_1).not.toContain('copy_starter_component');
    expect(BLOCK_1).not.toContain('tool_search_tool_bm25');
    expect(BLOCK_1).not.toContain('connect_github');
    expect(BLOCK_1).not.toContain('github_get_tree');
    expect(BLOCK_1).not.toContain('github_import_files');
    expect(BLOCK_1).not.toContain('github_read_file');
    expect(BLOCK_1).not.toContain('github_list_repos');
    expect(BLOCK_1).not.toContain('eval_js_user_view');
    expect(BLOCK_1).not.toContain('run_script');
    expect(BLOCK_1).not.toContain('gen_pptx');
    expect(BLOCK_1).not.toContain('read_pdf');
  });
  it('does NOT leak Anthropic-internal terminology (OSS hygiene)', () => {
    expect(BLOCK_1).not.toContain('omelette');
    expect(BLOCK_1).not.toContain('Omelette');
    expect(BLOCK_1).not.toContain('claudeusercontent.com');
  });
});
