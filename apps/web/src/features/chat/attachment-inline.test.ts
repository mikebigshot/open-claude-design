// inlineAttachmentsIntoText — pure helper that converts (text, attachments)
// into the final text payload sent to the LLM. v2 capture
// (research/claude-design-v2/05-skills-system.md + projectdata-test.json)
// shows skills / designSystems are NOT a separate field — they are inlined
// into the user message text as XML wrappers BEFORE the user's prose.
//
// W3 owns the helper; W1's wrapped sendMessage in use-agent-chat.ts is the
// call site (W1 wires it up; W3 just ships the function).
import { describe, expect, it } from 'vitest';
import { inlineAttachmentsIntoText } from './attachment-inline';
import type { Attachment } from './ui-messages';

const SKILL: Attachment = {
  id: 'a1',
  name: 'Make a deck',
  type: 'skill',
  content: 'Create a presentation deck.',
};

const DESIGN_SYSTEM: Attachment = {
  id: 'a2',
  name: 'Linear DS',
  type: 'designSystem',
  content: 'Use these tokens: --primary-100…',
};

const FILE_ATTACH: Attachment = {
  id: 'a3',
  name: 'spec.md',
  type: 'file',
  content: '# Spec\n\nHello.',
};

describe('inlineAttachmentsIntoText', () => {
  it('returns the original text unchanged when attachments is undefined', () => {
    expect(inlineAttachmentsIntoText('hello world', undefined)).toBe('hello world');
  });

  it('returns the original text unchanged when attachments is empty', () => {
    expect(inlineAttachmentsIntoText('hello world', [])).toBe('hello world');
  });

  it('wraps a single skill attachment with <skill-attachment name="X"> and prepends to text', () => {
    const out = inlineAttachmentsIntoText('please make a deck', [SKILL]);
    expect(out).toContain('<skill-attachment name="Make a deck">');
    expect(out).toContain('Create a presentation deck.');
    expect(out).toContain('</skill-attachment>');
    // Skill block precedes the user's prose.
    expect(out.indexOf('<skill-attachment')).toBeLessThan(out.indexOf('please make a deck'));
  });

  it('uses <design-system-guide name="X"> wrapper for designSystem type', () => {
    const out = inlineAttachmentsIntoText('use this DS', [DESIGN_SYSTEM]);
    expect(out).toContain('<design-system-guide name="Linear DS">');
    expect(out).toContain('Use these tokens');
    expect(out).toContain('</design-system-guide>');
  });

  it('uses generic <attachment type="X" name="Y"> wrapper for file/canvas/folder types', () => {
    const out = inlineAttachmentsIntoText('hello', [FILE_ATTACH]);
    expect(out).toContain('<attachment type="file" name="spec.md">');
    expect(out).toContain('# Spec');
    expect(out).toContain('</attachment>');
  });

  it('inlines multiple attachments in order, all before the user text', () => {
    const out = inlineAttachmentsIntoText('thanks', [SKILL, DESIGN_SYSTEM, FILE_ATTACH]);
    const skillIdx = out.indexOf('<skill-attachment');
    const dsIdx = out.indexOf('<design-system-guide');
    const fileIdx = out.indexOf('<attachment ');
    const userIdx = out.indexOf('thanks');
    expect(skillIdx).toBeGreaterThanOrEqual(0);
    expect(dsIdx).toBeGreaterThan(skillIdx);
    expect(fileIdx).toBeGreaterThan(dsIdx);
    expect(userIdx).toBeGreaterThan(fileIdx);
  });

  it('escapes double quotes in attachment names so they cannot break the wrapper', () => {
    const tricky: Attachment = {
      id: 'a4',
      name: 'has " quote',
      type: 'skill',
      content: 'body',
    };
    const out = inlineAttachmentsIntoText('hi', [tricky]);
    expect(out).toContain('name="has &quot; quote"');
    expect(out).not.toContain('name="has " quote"');
  });

  it('escapes ampersand and angle brackets in attachment names', () => {
    const tricky: Attachment = {
      id: 'a5',
      name: 'A & B <c>',
      type: 'skill',
      content: 'body',
    };
    const out = inlineAttachmentsIntoText('hi', [tricky]);
    // & must be encoded BEFORE < / > to avoid double-encoding.
    expect(out).toContain('name="A &amp; B &lt;c&gt;"');
  });

  it('handles empty user text gracefully (just the attachment + trailing newline)', () => {
    const out = inlineAttachmentsIntoText('', [SKILL]);
    expect(out).toContain('<skill-attachment name="Make a deck">');
    expect(out).toContain('</skill-attachment>');
    expect(out.trimEnd().endsWith('</skill-attachment>')).toBe(true);
  });

  it('preserves the original content body verbatim (no escaping inside the wrapper)', () => {
    // Inside the wrapper the body is the skill prompt — XML-escaping the
    // body would change semantics for the model. Only attribute values are
    // escaped.
    const richSkill: Attachment = {
      id: 'a6',
      name: 'X',
      type: 'skill',
      content: 'inline <code>tags</code> & "quotes" survive',
    };
    const out = inlineAttachmentsIntoText('q', [richSkill]);
    expect(out).toContain('inline <code>tags</code> & "quotes" survive');
  });
});
