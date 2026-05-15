// recoverPartialState — §2.10 helper.
//
// When the user clicks Stop mid-stream, AI SDK 6's chat.stop() aborts the
// underlying request. The Chat instance keeps any partial assistant
// message in `chat.messages` (its parts may be in `state: 'input-streaming'`
// or `state: 'input-available'` states without matching tool_results).
// On the next sendMessage, the LLM will be confused if it sees
// tool_use blocks without trailing tool_results.
//
// recoverPartialState walks the tail of the message list and:
//   - finds tool-X parts in non-terminal states ('input-streaming' or
//     'input-available') without an existing terminal state;
//   - marks them as 'output-available' with a synthetic
//     `{ aborted: true, message: 'Tool call cancelled by user.' }` output
//     so the LLM sees a closed shape next call.
//
// Returns `{ messages, recovered: boolean }` — `recovered` is true if any
// fix-up was applied.

import { describe, expect, it } from 'vitest';
import { recoverPartialState } from '../abort-recovery';

interface UIPart {
  type: string;
  state?: string;
  toolCallId?: string;
  output?: unknown;
}

interface TestMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: UIPart[];
}

describe('recoverPartialState', () => {
  it('returns input unchanged when there are no partial tool_use parts', () => {
    const msgs: TestMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_file',
            state: 'output-available',
            toolCallId: 'tc-1',
            output: { ok: true },
          },
        ],
      },
    ];
    const { messages, recovered } = recoverPartialState(msgs);
    expect(recovered).toBe(false);
    expect(messages).toEqual(msgs);
  });

  it('marks an "input-available" tool part as aborted with synthetic output', () => {
    const msgs: TestMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_file',
            state: 'input-available',
            toolCallId: 'tc-99',
          },
        ],
      },
    ];
    const { messages, recovered } = recoverPartialState(msgs);
    expect(recovered).toBe(true);
    const part = messages[0]?.parts[0] as UIPart;
    expect(part.state).toBe('output-available');
    expect(part.output).toMatchObject({ aborted: true });
  });

  it('marks an "input-streaming" tool part as aborted', () => {
    const msgs: TestMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-read_file',
            state: 'input-streaming',
            toolCallId: 'tc-2',
          },
        ],
      },
    ];
    const { messages, recovered } = recoverPartialState(msgs);
    expect(recovered).toBe(true);
    expect((messages[0]?.parts[0] as UIPart).state).toBe('output-available');
  });

  it('handles multiple partial tool parts in the same assistant message', () => {
    const msgs: TestMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'tool-write_file', state: 'input-available', toolCallId: 'tc-1' },
          { type: 'tool-read_file', state: 'input-streaming', toolCallId: 'tc-2' },
        ],
      },
    ];
    const { messages, recovered } = recoverPartialState(msgs);
    expect(recovered).toBe(true);
    expect((messages[0]?.parts[0] as UIPart).state).toBe('output-available');
    expect((messages[0]?.parts[1] as UIPart).state).toBe('output-available');
  });

  it('does not modify "output-error" or other terminal states', () => {
    const msgs: TestMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-write_file', state: 'output-error', toolCallId: 'tc-1' }],
      },
    ];
    const { messages, recovered } = recoverPartialState(msgs);
    expect(recovered).toBe(false);
    expect((messages[0]?.parts[0] as UIPart).state).toBe('output-error');
  });

  it('returns a new array when fixing (does not mutate input)', () => {
    const msgs: TestMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool-write_file', state: 'input-available', toolCallId: 'tc-1' }],
      },
    ];
    const original = JSON.parse(JSON.stringify(msgs));
    recoverPartialState(msgs);
    expect(msgs).toEqual(original);
  });

  it('only inspects assistant messages (user messages with tool parts left alone)', () => {
    const msgs: TestMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'tool-something', state: 'input-streaming', toolCallId: 'tc-1' }],
      },
    ];
    const { messages, recovered } = recoverPartialState(msgs);
    expect(recovered).toBe(false);
    expect(messages).toEqual(msgs);
  });
});
