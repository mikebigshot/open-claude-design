// user-message-queue — §2.2 helper for "queued user input wrapped in
// <user_message> XML tags".
//
// v2 reference: main-agent-loop-full.raw.js — when the user sends a message
// while the agent is mid-turn, the loop accumulates them in a per-chat
// queue (Ch(r) / Ia.get/Wne(...)). At the next turn boundary, queued
// messages are wrapped:
//
//   <user_message>${queued}</user_message>
//
// and prepended to the next user message body alongside any pending
// tool_results. Multiple queued messages are joined with newlines (each
// becomes its own <user_message> wrapper).

import { describe, expect, it } from 'vitest';
import {
  USER_MESSAGE_CLOSE,
  USER_MESSAGE_OPEN,
  wrapPendingUserMessage,
  wrapPendingUserMessages,
} from '../user-message-queue';

describe('user-message tags', () => {
  it('exports the literal tags', () => {
    expect(USER_MESSAGE_OPEN).toBe('<user_message>');
    expect(USER_MESSAGE_CLOSE).toBe('</user_message>');
  });
});

describe('wrapPendingUserMessage', () => {
  it('wraps a single text body in <user_message> tags', () => {
    expect(wrapPendingUserMessage('hello world')).toBe('<user_message>hello world</user_message>');
  });

  it('preserves internal newlines verbatim (no escaping)', () => {
    expect(wrapPendingUserMessage('line 1\nline 2')).toBe(
      '<user_message>line 1\nline 2</user_message>',
    );
  });

  it('handles empty body', () => {
    expect(wrapPendingUserMessage('')).toBe('<user_message></user_message>');
  });
});

describe('wrapPendingUserMessages (plural)', () => {
  it('returns empty string for empty queue', () => {
    expect(wrapPendingUserMessages([])).toBe('');
  });

  it('wraps single queued message', () => {
    expect(wrapPendingUserMessages(['hi'])).toBe('<user_message>hi</user_message>');
  });

  it('joins multiple messages with newlines, each independently wrapped', () => {
    expect(wrapPendingUserMessages(['first', 'second', 'third'])).toBe(
      '<user_message>first</user_message>\n<user_message>second</user_message>\n<user_message>third</user_message>',
    );
  });

  it('skips empty/whitespace-only entries', () => {
    expect(wrapPendingUserMessages(['hi', '', '  ', 'there'])).toBe(
      '<user_message>hi</user_message>\n<user_message>there</user_message>',
    );
  });
});
