// stripAttachmentBlocks — pure helper that removes the XML wrappers added by
// inlineAttachmentsIntoText (skill / design-system / generic attachment) so the
// ChatMsg user-bubble shows clean prose. The XML is meant for the LLM, not the
// human reader.
//
// Pairs with inlineAttachmentsIntoText (forward direction). This is the reverse
// surface used only for display — the agent path still sees the wrapped text.

import { describe, expect, it } from 'vitest';
import { stripAttachmentBlocks } from './strip-attachment-blocks';

describe('stripAttachmentBlocks', () => {
  it('returns the text unchanged when there are no blocks', () => {
    const r = stripAttachmentBlocks('please make a deck');
    expect(r.visibleText).toBe('please make a deck');
    expect(r.chips).toEqual([]);
  });

  it('strips a leading skill-attachment block emitted by inlineAttachmentsIntoText', () => {
    const text =
      '<skill-attachment name="Make a deck">\nCreate a 10-slide deck about cats.\n</skill-attachment>\n\nplease make a deck';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe('please make a deck');
    expect(r.chips).toEqual([{ type: 'skill', name: 'Make a deck' }]);
    expect(r.visibleText).not.toContain('<skill-attachment');
    expect(r.visibleText).not.toContain('</skill-attachment>');
  });

  it('strips a leading design-system-guide block', () => {
    const text =
      '<design-system-guide name="Linear DS">\nUse --primary-100 tokens.\n</design-system-guide>\n\nuse these tokens';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe('use these tokens');
    expect(r.chips).toEqual([{ type: 'designSystem', name: 'Linear DS' }]);
  });

  it('strips a leading generic attachment block (e.g. file)', () => {
    const text =
      '<attachment type="file" name="spec.md">\n# Spec\nthings\n</attachment>\n\ndo the spec';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe('do the spec');
    expect(r.chips).toEqual([{ type: 'file', name: 'spec.md' }]);
  });

  it('strips multiple blocks in order and preserves the trailing prose', () => {
    const text =
      '<skill-attachment name="Make a deck">\nA\n</skill-attachment>\n\n<design-system-guide name="Linear DS">\nB\n</design-system-guide>\n\nmix it up';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe('mix it up');
    expect(r.chips).toEqual([
      { type: 'skill', name: 'Make a deck' },
      { type: 'designSystem', name: 'Linear DS' },
    ]);
    expect(r.visibleText).not.toContain('<skill-attachment');
    expect(r.visibleText).not.toContain('<design-system-guide');
  });

  it('decodes HTML-escaped name attributes (round-trip with inlineAttachmentsIntoText)', () => {
    // inlineAttachmentsIntoText encodes & < > " in name; strip should decode.
    const text =
      '<skill-attachment name="A &amp; B &lt;1&gt; &quot;x&quot;">\nbody\n</skill-attachment>\n\nhello';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe('hello');
    expect(r.chips).toEqual([{ type: 'skill', name: 'A & B <1> "x"' }]);
  });

  it('handles a block with multi-line body containing < and > characters', () => {
    const text =
      '<skill-attachment name="Make a deck">\nUse `<div>` and `<span>` here.\nMore text.\n</skill-attachment>\n\nrender it';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe('render it');
    expect(r.chips).toEqual([{ type: 'skill', name: 'Make a deck' }]);
  });

  it('leaves the text untouched if a block is unclosed (refuses to eat the rest of the prose)', () => {
    const text = '<skill-attachment name="Broken">\nstart of body but no end tag\n\nmore prose';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe(text);
    expect(r.chips).toEqual([]);
  });

  it('handles attachment-only payload (no trailing user prose)', () => {
    const text = '<skill-attachment name="Make a deck">\nbody\n</skill-attachment>\n';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe('');
    expect(r.chips).toEqual([{ type: 'skill', name: 'Make a deck' }]);
  });

  it('preserves leading prose if a block appears AFTER user text (uncommon path)', () => {
    // We only emit blocks at the very beginning, but a saved message could
    // hypothetically contain mid-text blocks. The helper should still strip
    // them out and join the surrounding prose with a single blank line.
    const text =
      'I want\n\n<skill-attachment name="Make a deck">\nbody\n</skill-attachment>\n\nthis done';
    const r = stripAttachmentBlocks(text);
    expect(r.visibleText).toBe('I want\n\nthis done');
    expect(r.chips).toEqual([{ type: 'skill', name: 'Make a deck' }]);
  });
});
