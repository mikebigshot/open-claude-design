// post-done-enforce — detects the "done was called but fork_verifier_agent
// was skipped" pattern that Haiku 4.5 falls into ~30-40% of the time even
// after the v2-aligned nudge in done.ts. The helper returns the toolCallId
// of the unforked done so the orchestrator can inject a user reminder.
//
// Handoff §P1 option 3 (Hard enforce). Reactive — fires AFTER the model
// finishes its turn; complementary to system-prompt nudges (option 2).

import { describe, expect, it } from 'vitest';
import type { DesignAgentUIMessage } from '../../ui-messages';
import { findUnforkedDone } from '../post-done-enforce';

type Msg = DesignAgentUIMessage;

// Compact helpers — keep test fixtures readable.
const text = (role: 'user' | 'assistant', body: string, id = `m${Math.random()}`): Msg =>
  ({
    id,
    role,
    parts: [{ type: 'text', text: body }],
  }) as unknown as Msg;

const done = (id: string, callId: string): Msg =>
  ({
    id,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Wrapping up.' },
      { type: 'tool-done', state: 'output-available', toolCallId: callId, input: {} },
    ],
  }) as unknown as Msg;

const fork = (id: string, callId: string): Msg =>
  ({
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-fork_verifier_agent',
        state: 'output-available',
        toolCallId: callId,
        input: {},
      },
    ],
  }) as unknown as Msg;

const otherTool = (id: string, callId: string, toolType: string): Msg =>
  ({
    id,
    role: 'assistant',
    parts: [{ type: toolType, state: 'output-available', toolCallId: callId, input: {} }],
  }) as unknown as Msg;

describe('findUnforkedDone', () => {
  it('returns null when there is no done call at all', () => {
    const msgs: Msg[] = [text('user', 'hi'), text('assistant', 'hello!')];
    expect(findUnforkedDone(msgs)).toBeNull();
  });

  it('returns null when done was followed by fork_verifier_agent', () => {
    const msgs: Msg[] = [
      text('user', 'do task'),
      done('m2', 'call-done-1'),
      fork('m3', 'call-fork-1'),
    ];
    expect(findUnforkedDone(msgs)).toBeNull();
  });

  it('returns the done toolCallId when the next assistant turn is text-only', () => {
    const msgs: Msg[] = [
      text('user', 'do task'),
      done('m2', 'call-done-1'),
      text('assistant', 'All set. Let me know if you want changes.'),
    ];
    expect(findUnforkedDone(msgs)).toEqual({ doneToolCallId: 'call-done-1' });
  });

  it('returns the done toolCallId when the loop ended at the done message itself (no follow-up)', () => {
    // If `done` was the LAST assistant message and the loop already finished
    // (no further assistant turn), that also counts as "fork was skipped".
    const msgs: Msg[] = [text('user', 'do task'), done('m2', 'call-done-1')];
    expect(findUnforkedDone(msgs)).toEqual({ doneToolCallId: 'call-done-1' });
  });

  it('returns null when an assistant after done called some OTHER tool (still in progress)', () => {
    // If the model invoked write_file or screenshot after done, the loop is
    // still active — we shouldn't pre-emptively scold. Only nudge once it
    // settles into text-only.
    const msgs: Msg[] = [
      text('user', 'do task'),
      done('m2', 'call-done-1'),
      otherTool('m3', 'call-other-1', 'tool-write_file'),
    ];
    expect(findUnforkedDone(msgs)).toBeNull();
  });

  it('uses the most recent done if there were multiple done calls in history', () => {
    const msgs: Msg[] = [
      text('user', 'do task one'),
      done('m2', 'call-done-1'),
      fork('m3', 'call-fork-1'),
      text('user', 'do task two'),
      done('m5', 'call-done-2'),
      text('assistant', 'I think we are done.'),
    ];
    expect(findUnforkedDone(msgs)).toEqual({ doneToolCallId: 'call-done-2' });
  });

  it('ignores done parts that are not yet output-available (still streaming)', () => {
    const msgs: Msg[] = [
      text('user', 'do task'),
      {
        id: 'm2',
        role: 'assistant',
        parts: [{ type: 'tool-done', state: 'input-available', toolCallId: 'call-done-1' }],
      } as unknown as Msg,
    ];
    expect(findUnforkedDone(msgs)).toBeNull();
  });

  it('handles done immediately followed by another user message + assistant text (interleaved chat)', () => {
    // The user might type something while the agent was finishing. The
    // follow-up assistant turn that responds to the new user message is what
    // we evaluate — if it's text-only and there was no fork between done
    // and now, we still nudge.
    const msgs: Msg[] = [
      text('user', 'do task'),
      done('m2', 'call-done-1'),
      text('user', 'oh wait actually'),
      text('assistant', 'sure, what would you like to change?'),
    ];
    expect(findUnforkedDone(msgs)).toEqual({ doneToolCallId: 'call-done-1' });
  });
});
