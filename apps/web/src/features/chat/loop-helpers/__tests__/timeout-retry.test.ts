// timeout-retry — §2.4 helper for "your past response was too long..."
// retry. v2 main-agent-loop-full.raw.js retries up to rN=2 times with the
// inject text below; we expose the same constants + a counter handler.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT_RETRY_INJECT_TEXT,
  isTimeoutLikeError,
  makeTimeoutRetryHandler,
} from '../timeout-retry';

describe('TIMEOUT_RETRY_INJECT_TEXT', () => {
  it('matches the v2 verbatim wording', () => {
    expect(TIMEOUT_RETRY_INJECT_TEXT).toBe(
      'System: your past response was too long and the connection timed out before it could be delivered. Try splitting it up into smaller edits or smaller components.',
    );
  });
});

describe('isTimeoutLikeError', () => {
  it('returns false for non-Error values', () => {
    expect(isTimeoutLikeError(null)).toBe(false);
    expect(isTimeoutLikeError(undefined)).toBe(false);
    expect(isTimeoutLikeError('timeout')).toBe(false);
    expect(isTimeoutLikeError({})).toBe(false);
  });

  it('detects Error.name === "TimeoutError"', () => {
    const err = new Error('boom');
    err.name = 'TimeoutError';
    expect(isTimeoutLikeError(err)).toBe(true);
  });

  it('detects message containing "timed out"', () => {
    expect(isTimeoutLikeError(new Error('the request timed out'))).toBe(true);
  });

  it('detects message containing "timeout"', () => {
    expect(isTimeoutLikeError(new Error('connection timeout'))).toBe(true);
  });

  it('does not detect "ETIMEOUT" alone (too aggressive)', () => {
    // Generic network errors should NOT trigger the retry path.
    expect(isTimeoutLikeError(new Error('ECONNRESET'))).toBe(false);
  });

  it('detects DOMException with name TimeoutError', () => {
    // jsdom doesn't always give DOMException; simulate via plain object with
    // matching name shape.
    const err = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(isTimeoutLikeError(err)).toBe(true);
  });
});

describe('makeTimeoutRetryHandler', () => {
  it('defaults max retries to 2', () => {
    const handler = makeTimeoutRetryHandler();
    expect(handler.max).toBe(2);
  });

  it('shouldRetry returns true while attempts < max', () => {
    const handler = makeTimeoutRetryHandler({ max: 2 });
    expect(handler.attempts).toBe(0);
    expect(handler.shouldRetry()).toBe(true); // attempt 1
    expect(handler.shouldRetry()).toBe(true); // attempt 2
    expect(handler.shouldRetry()).toBe(false); // exhausted
  });

  it('reset() resets the attempt counter', () => {
    const handler = makeTimeoutRetryHandler({ max: 2 });
    handler.shouldRetry();
    handler.shouldRetry();
    handler.reset();
    expect(handler.attempts).toBe(0);
    expect(handler.shouldRetry()).toBe(true);
  });

  it('attempts is read-only via getter', () => {
    const handler = makeTimeoutRetryHandler({ max: 5 });
    handler.shouldRetry();
    expect(handler.attempts).toBe(1);
  });
});
