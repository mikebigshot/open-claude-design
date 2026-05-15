// inlineAttachmentsIntoText — pure helper that converts (text, attachments)
// into the final text payload sent to the LLM.
//
// v2 capture (research/claude-design-v2/05-skills-system.md +
// artifacts/projectdata-test.json) shows skills / designSystems are NOT
// transmitted via a separate message field — they are inlined into the user
// message text as XML wrappers BEFORE the user's prose. The model then sees
// the attached prompt as part of the latest user turn.
//
// W3 ships the helper. W1's wrapped sendMessage in `use-agent-chat.ts` is the
// call site (W1 wires it during the loop-body merge).

import type { Attachment } from './ui-messages.js';

/**
 * HTML-style escape for attribute values. Order matters: `&` must be encoded
 * BEFORE `<` / `>` to avoid double-encoding the `&lt;` / `&gt;` we just
 * inserted.
 */
function escAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Wrap one attachment as the XML block we want the model to see. Body is
 * NOT escaped — it's the skill prompt / design-system guide, and escaping
 * would change semantics for the model.
 */
function wrap(att: Attachment): string {
  switch (att.type) {
    case 'skill':
      return `<skill-attachment name="${escAttr(att.name)}">\n${att.content}\n</skill-attachment>`;
    case 'designSystem':
      return `<design-system-guide name="${escAttr(att.name)}">\n${att.content}\n</design-system-guide>`;
    default:
      return `<attachment type="${escAttr(att.type)}" name="${escAttr(att.name)}">\n${att.content}\n</attachment>`;
  }
}

/**
 * Convert (userText, attachments[]) → final text payload sent to the LLM.
 *
 * Pure: no I/O, deterministic, safe to call in any thread/context.
 *
 * Behaviour:
 * - undefined / empty attachments → text returned verbatim.
 * - one or more attachments → each wrapped per type, joined by blank line,
 *   then prepended (with a blank-line gap) to the user text.
 * - empty user text + at least one attachment → just the wrapped block(s)
 *   with a single trailing newline.
 */
export function inlineAttachmentsIntoText(text: string, attachments?: Attachment[]): string {
  if (!attachments || attachments.length === 0) return text;
  const blocks = attachments.map(wrap).join('\n\n');
  if (!text) return `${blocks}\n`;
  return `${blocks}\n\n${text}`;
}
