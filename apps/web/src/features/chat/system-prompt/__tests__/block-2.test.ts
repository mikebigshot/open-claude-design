import { describe, expect, it } from 'vitest';
import { buildBlock2 } from '../block-2';

describe('buildBlock2', () => {
  it('renders the design-system-id placeholder when none is provided', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(out).toContain('<design-system-id>none</design-system-id>');
    expect(out).toContain('<user-email-domain>unknown</user-email-domain>');
  });

  it('renders the design-system-id when provided', () => {
    const out = buildBlock2({
      designSystemId: 'c8374854-27cd-4e8e-b693-cfea4d612129',
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(out).toContain(
      '<design-system-id>c8374854-27cd-4e8e-b693-cfea4d612129</design-system-id>',
    );
  });

  it('renders an Available Skills bullet for each provided skill', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [
        {
          name: 'Frontend design',
          description: 'Aesthetic direction for designs outside an existing brand system',
        },
        { name: 'Wireframe', description: 'Explore many ideas with wireframes and storyboards' },
      ],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(out).toContain(
      '- **Frontend design** — Aesthetic direction for designs outside an existing brand system',
    );
    expect(out).toContain('- **Wireframe** — Explore many ideas with wireframes and storyboards');
  });

  it('renders the no-CLAUDE.md fallback when claudeMdContent is undefined', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(out).toContain('This project has no `CLAUDE.md`.');
  });

  it('inlines CLAUDE.md content when provided', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: 'Use Tailwind. Prefer dark theme.',
      userEmailDomain: undefined,
    });
    expect(out).toContain('Use Tailwind. Prefer dark theme.');
  });

  it('renders the multi-file React JSX bundle override (default App.jsx)', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(out).toContain('## Output Format (override)');
    expect(out).toContain('multi-file React JSX bundle');
    expect(out).toContain('App.jsx');
    expect(out).toContain('Do not create `.html` files');
    expect(out).toContain('EDITMODE-BEGIN');
  });

  it('places the override before the user-email-domain footer', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    const overrideIdx = out.indexOf('## Output Format (override)');
    const footerIdx = out.indexOf('<user-email-domain>');
    expect(overrideIdx).toBeGreaterThan(0);
    expect(footerIdx).toBeGreaterThan(overrideIdx);
  });

  it('renders the verifier sub-agent guidance section (aligned with official: fork AFTER done)', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(out).toContain('Verifier sub-agent (`fork_verifier_agent`)');
    expect(out).toContain('verification_feedback');
    expect(out).toContain('A background task has completed');
    // Official ordering: fork AFTER done reports clean (research v2 §03 + §14).
    expect(out).toMatch(/Once `done` reports clean,? call `fork_verifier_agent`/);
    // Directed-check mode with `task` parameter.
    expect(out).toContain('fork_verifier_agent({task');
    // Guard against re-forking when current message is itself a verdict.
    expect(out).toMatch(/do not call `fork_verifier_agent` again/i);
  });

  it('places the verifier guidance after the override and before the footer', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    const overrideIdx = out.indexOf('## Output Format (override)');
    const verifierIdx = out.indexOf('Verifier sub-agent');
    const footerIdx = out.indexOf('<user-email-domain>');
    expect(overrideIdx).toBeGreaterThan(0);
    expect(verifierIdx).toBeGreaterThan(overrideIdx);
    expect(footerIdx).toBeGreaterThan(verifierIdx);
  });

  // ── "None" design-system pick ──────────────────────────────────────────────
  // When the user explicitly selects "No design system" in the picker, the
  // form forwards designSystemId='none' to the agent. Block-2 must surface
  // that as a distinct guidance section (free-style design judgement, no
  // external CDN) so the agent can branch on it.
  it("emits the 'no design system' guidance when designSystemId is 'none'", () => {
    const out = buildBlock2({
      designSystemId: 'none',
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(out).toContain('<design-system-id>none</design-system-id>');
    expect(out).toContain('## No design system selected');
    expect(out).toContain('feel free to use your own design judgment');
    // Don't pull external design-system runtime deps when the user asked
    // for "none".
    expect(out).toContain('do **not** add a runtime dependency');
  });

  it('omits the no-design-system guidance for any other designSystemId', () => {
    const outDs = buildBlock2({
      designSystemId: 'ds-abc',
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(outDs).not.toContain('## No design system selected');

    // undefined designSystemId currently falls back to the literal 'none'
    // string in the <design-system-id> tag (preserved behaviour for the
    // default "Open Design Default" path), but must NOT trigger the
    // explicit no-design-system guidance — that section is reserved for the
    // user's deliberate "None" pick.
    const outUndef = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(outUndef).not.toContain('## No design system selected');
  });

  // ── v2 trim-tags note ──────────────────────────────────────────────────
  // v2 capture (research/claude-design-v2/artifacts/system-prompt/block-1-context.md)
  // appends a "Note: Parts of this conversation may be automatically trimmed..."
  // paragraph that teaches the agent to recognise (and not echo) the system-
  // inserted <dropped_messages> / <trimmed> / <orphaned_*> sigils that the
  // context-management pipeline produces when a long conversation needs to
  // shrink. See research/claude-design-v2/09-changes-vs-v1.md §9.3.3.
  it('appends the trim-tags note paragraph at the end (post-footer)', () => {
    const out = buildBlock2({
      designSystemId: undefined,
      skills: [],
      claudeMdContent: undefined,
      userEmailDomain: undefined,
    });
    expect(out).toContain('Parts of this conversation may be automatically trimmed');
    expect(out).toContain('<dropped_messages>');
    expect(out).toContain('<orphaned_tool_call>');
    expect(out).toContain('<orphaned_tool_result>');
    expect(out).toContain('<trimmed_image>');
    // The paragraph is positioned AFTER the user-email-domain footer per
    // v2 verbatim capture.
    const footerIdx = out.indexOf('<user-email-domain>');
    const trimNoteIdx = out.indexOf('Parts of this conversation');
    expect(trimNoteIdx).toBeGreaterThan(footerIdx);
  });
});
