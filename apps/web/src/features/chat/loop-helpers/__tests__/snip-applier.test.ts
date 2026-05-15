// snip-applier — §2.1 algorithm: take a list of "from_id..to_id" snip
// registrations and remove the corresponding `[id:m0001]`-tagged user
// messages from the conversation history (along with everything between
// them, like assistant replies + tool results).
//
// v2 reference: main-agent-loop-full.raw.js — `L4(M, r)` walks the
// registered snips, finds the user message indices via `[id:${tag}]`
// suffix matching, and splices the range out of the messages array.
//
// Algorithm:
//   1. For each registered snip { from, to }:
//      - find user message at index `i_from` whose textual content ends
//        with `[id:${from}]`
//      - find user message at index `i_to` whose textual content ends
//        with `[id:${to}]`
//      - if both found and i_from <= i_to, splice (i_to - i_from + 1)
//        elements starting at i_from
//   2. Return the new (shortened) messages array + count of applied snips.

import { describe, expect, it } from 'vitest';
import { applyPendingSnips, type RegisteredSnip } from '../snip-applier';

interface TestMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
}

function userMsg(text: string): TestMessage {
  return { role: 'user', content: text };
}

function assistantMsg(text: string): TestMessage {
  return { role: 'assistant', content: text };
}

describe('applyPendingSnips', () => {
  it('returns original messages unchanged when no snips registered', () => {
    const msgs: TestMessage[] = [userMsg('hi [id:m0001]'), assistantMsg('hello')];
    const { messages, snipsApplied } = applyPendingSnips(msgs, []);
    expect(snipsApplied).toBe(0);
    expect(messages).toEqual(msgs);
    expect(messages).not.toBe(msgs); // returns a new array
  });

  it('removes a single-message range (from === to)', () => {
    const msgs: TestMessage[] = [
      userMsg('first message [id:m0001]'),
      assistantMsg('first reply'),
      userMsg('second message [id:m0002]'),
      assistantMsg('second reply'),
    ];
    const snips: RegisteredSnip[] = [{ from: 'm0001', to: 'm0001' }];
    const { messages, snipsApplied } = applyPendingSnips(msgs, snips);
    expect(snipsApplied).toBe(1);
    // m0001 user message + everything until next user (the assistant reply)
    // should be gone. v2 algorithm: splice from i_from..i_to inclusive of
    // both user messages, dropping intermediates.
    expect(messages).toEqual([userMsg('second message [id:m0002]'), assistantMsg('second reply')]);
  });

  it('removes a multi-message range (from..to inclusive, plus trailing assistant replies attached to the to-id user message)', () => {
    const msgs: TestMessage[] = [
      userMsg('one [id:m0001]'),
      assistantMsg('reply 1'),
      userMsg('two [id:m0002]'),
      assistantMsg('reply 2'),
      userMsg('three [id:m0003]'),
      assistantMsg('reply 3'),
      userMsg('four [id:m0004]'),
    ];
    const snips: RegisteredSnip[] = [{ from: 'm0001', to: 'm0003' }];
    const { messages, snipsApplied } = applyPendingSnips(msgs, snips);
    expect(snipsApplied).toBe(1);
    // The deletion covers user msg m0001 → user msg m0003 inclusive AND
    // all assistant content attached to those user messages (i.e. up to
    // the index of the next user message m0004). reply 3 is the assistant
    // response to m0003, so it goes too.
    expect(messages).toEqual([userMsg('four [id:m0004]')]);
  });

  it('handles array content (multipart user messages)', () => {
    const msgs: TestMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello [id:m0001]' }] },
      assistantMsg('reply'),
      { role: 'user', content: [{ type: 'text', text: 'world [id:m0002]' }] },
    ];
    const { messages, snipsApplied } = applyPendingSnips(msgs, [{ from: 'm0001', to: 'm0001' }]);
    expect(snipsApplied).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
  });

  it('skips a snip whose from_id is missing', () => {
    const msgs: TestMessage[] = [userMsg('a [id:m0001]')];
    const { messages, snipsApplied } = applyPendingSnips(msgs, [{ from: 'm0099', to: 'm0099' }]);
    expect(snipsApplied).toBe(0);
    expect(messages).toEqual(msgs);
  });

  it('skips a snip whose to_id comes before from_id', () => {
    const msgs: TestMessage[] = [userMsg('a [id:m0001]'), userMsg('b [id:m0002]')];
    const { messages, snipsApplied } = applyPendingSnips(msgs, [{ from: 'm0002', to: 'm0001' }]);
    expect(snipsApplied).toBe(0);
    expect(messages).toEqual(msgs);
  });

  it('applies multiple non-overlapping snips (back-to-back user msgs, no replies between)', () => {
    const msgs: TestMessage[] = [
      userMsg('a [id:m0001]'),
      userMsg('b [id:m0002]'),
      userMsg('c [id:m0003]'),
      userMsg('d [id:m0004]'),
      userMsg('e [id:m0005]'),
    ];
    const snips: RegisteredSnip[] = [
      { from: 'm0001', to: 'm0001' },
      { from: 'm0004', to: 'm0004' },
    ];
    const { messages, snipsApplied } = applyPendingSnips(msgs, snips);
    expect(snipsApplied).toBe(2);
    // No assistant messages between, so no trailing-reply absorption — each
    // snip removes just the named user msg.
    expect(messages).toEqual([
      userMsg('b [id:m0002]'),
      userMsg('c [id:m0003]'),
      userMsg('e [id:m0005]'),
    ]);
  });

  it('matches via id-tag SUFFIX (so descriptive prefixes are tolerated)', () => {
    const msgs: TestMessage[] = [
      userMsg('Some long preamble [id:m0001]'),
      assistantMsg('reply'),
      userMsg('Another [id:m0002]'),
    ];
    const { messages, snipsApplied } = applyPendingSnips(msgs, [{ from: 'm0001', to: 'm0001' }]);
    expect(snipsApplied).toBe(1);
    expect(messages).toHaveLength(1);
  });

  // ── Boundary extension across synthetic tool_result user messages ──
  // The SDK emits synthetic user messages carrying tool_result parts in
  // response to assistant tool_use parts; those synthetic msgs have no
  // [id:mNNNN] tag. Removing up to a synthetic user msg would orphan its
  // tool_result; the algorithm must extend past it to the next tagged
  // user msg.
  it("extends i_to past synthetic (untagged) user messages so tool_use/tool_result pairs stay together", () => {
    const msgs: TestMessage[] = [
      userMsg('a [id:m0001]'),
      assistantMsg('tool_use 1'),
      userMsg('synthetic tool_result A'), // NO [id] tag — synthetic
      assistantMsg('reply 1'),
      userMsg('b [id:m0002]'), // tagged
      assistantMsg('tool_use 2'),
      userMsg('synthetic tool_result B'), // NO [id] tag — synthetic
      assistantMsg('reply 2'),
      userMsg('c [id:m0003]'), // next tagged after m0002
    ];
    const { messages, snipsApplied } = applyPendingSnips(msgs, [
      { from: 'm0001', to: 'm0002' },
    ]);
    expect(snipsApplied).toBe(1);
    // Everything from a..(through synthetic-B + reply 2) is removed. Only
    // the c-tagged user msg survives. Crucially, synthetic-B is NOT left
    // dangling without its tool_use parent.
    expect(messages.map((m) => stringifyTestContent(m.content))).toEqual([
      'c [id:m0003]',
    ]);
  });

  it("a snip whose 'to' is the LAST tagged user still extends past any trailing synthetic msgs", () => {
    const msgs: TestMessage[] = [
      userMsg('a [id:m0001]'),
      assistantMsg('tool_use'),
      userMsg('synthetic'), // synthetic user msg trails
    ];
    const { messages, snipsApplied } = applyPendingSnips(msgs, [
      { from: 'm0001', to: 'm0001' },
    ]);
    expect(snipsApplied).toBe(1);
    // Without boundary extension, the synthetic tail would survive as an
    // orphan tool_result. With it, the whole conversation is empty.
    expect(messages).toHaveLength(0);
  });
});

function stringifyTestContent(content: TestMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
    .join('');
}
