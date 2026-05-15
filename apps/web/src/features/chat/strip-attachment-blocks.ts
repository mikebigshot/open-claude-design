// stripAttachmentBlocks — pure helper that removes XML wrappers added by
// inlineAttachmentsIntoText from a user message text so the chat bubble shows
// clean prose. The LLM still sees the wrapped text (the strip is display-only).
//
// Pairs with `inlineAttachmentsIntoText`. Round-trips the HTML-escaped `name`
// attribute (re-decodes &amp; / &lt; / &gt; / &quot;).

export interface StrippedAttachmentChip {
  /** Stable label group: 'skill' / 'designSystem' / the raw `type` attribute of a generic block. */
  type: string;
  /** Display name (decoded from the wrapper's name= attribute). */
  name: string;
}

export interface StripResult {
  visibleText: string;
  chips: StrippedAttachmentChip[];
}

/** Reverse of `escAttr` in attachment-inline.ts. Order: numeric / quote / lt / gt / amp last. */
function decodeAttr(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// One regex per recognised wrapper. `[\s\S]*?` so a single attr can't slurp
// across the body, and the body itself uses `[\s\S]*?` lazy so we stop at the
// first matching close tag. Anchoring the close tag inside the same family
// (e.g. skill-attachment open ↔ skill-attachment close) prevents a runaway
// across mismatched wrappers.
const PATTERNS: Array<{ re: RegExp; type: string; nameFrom: 'name' | 'name'; useTypeAttr?: boolean }> =
  [
    { re: /<skill-attachment\s+name="([^"]*?)"\s*>[\s\S]*?<\/skill-attachment>/g, type: 'skill', nameFrom: 'name' },
    {
      re: /<design-system-guide\s+name="([^"]*?)"\s*>[\s\S]*?<\/design-system-guide>/g,
      type: 'designSystem',
      nameFrom: 'name',
    },
    {
      re: /<attachment\s+type="([^"]*?)"\s+name="([^"]*?)"\s*>[\s\S]*?<\/attachment>/g,
      type: '',
      nameFrom: 'name',
      useTypeAttr: true,
    },
  ];

interface Match {
  start: number;
  end: number;
  chip: StrippedAttachmentChip;
}

export function stripAttachmentBlocks(text: string): StripResult {
  if (!text || text.indexOf('<') === -1) {
    return { visibleText: text, chips: [] };
  }

  // Collect all matches across the three patterns, then merge in source order.
  const matches: Match[] = [];
  for (const p of PATTERNS) {
    // Local re — global regexes hold a lastIndex; re-create to keep this fn pure.
    const re = new RegExp(p.re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // m[n] is `string | undefined` under `noUncheckedIndexedAccess`; the
      // patterns guarantee the captures exist when `exec` matches, fall back
      // to '' defensively.
      const chip: StrippedAttachmentChip = p.useTypeAttr
        ? { type: decodeAttr(m[1] ?? ''), name: decodeAttr(m[2] ?? '') }
        : { type: p.type, name: decodeAttr(m[1] ?? '') };
      matches.push({ start: m.index, end: m.index + m[0].length, chip });
    }
  }

  if (matches.length === 0) {
    return { visibleText: text, chips: [] };
  }

  matches.sort((a, b) => a.start - b.start);

  // Excise each match. Joining trims redundant blank lines so 'A\n\nBLOCK\n\nC'
  // collapses to 'A\n\nC' rather than 'A\n\n\n\nC'.
  let cursor = 0;
  const pieces: string[] = [];
  for (const m of matches) {
    pieces.push(text.slice(cursor, m.start));
    cursor = m.end;
  }
  pieces.push(text.slice(cursor));

  let visible = pieces.join('');
  // Tighten: collapse 3+ consecutive newlines to exactly 2, then trim leading /
  // trailing blank padding the wrapper left behind.
  visible = visible.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');

  return { visibleText: visible, chips: matches.map((m) => m.chip) };
}
