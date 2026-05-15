// mcp-schema-retry — §2.3 helper for "third-party MCP returned a malformed
// inputSchema → LLM rejects the whole turn" recovery.
//
// v2 main-agent-loop-full.raw.js has a `U7(err)` extractor that pulls the
// failing tool name out of an Anthropic API error's debugInfo.fieldPath
// (e.g. "tools.3.input_schema.properties.foo" → "tools[3]"). We can't
// always reach that level with AI SDK's wrapper, so we also accept a
// permissive message regex.

import { describe, expect, it } from 'vitest';
import {
  makeMcpSchemaRetryHandler,
  parseSchemaRejectionToolName,
  removeFailingTool,
} from '../mcp-schema-retry';

describe('parseSchemaRejectionToolName', () => {
  it('returns null for non-Error values', () => {
    expect(parseSchemaRejectionToolName(null)).toBeNull();
    expect(parseSchemaRejectionToolName('boom')).toBeNull();
  });

  it('extracts via debugInfo.toolName when present (AI SDK shape)', () => {
    const err = Object.assign(new Error('schema rejection'), {
      debugInfo: { toolName: 'paypal__pay' },
    });
    expect(parseSchemaRejectionToolName(err)).toBe('paypal__pay');
  });

  it('extracts via debugInfo.fieldPath ("tools[3].input_schema...")', () => {
    const err = Object.assign(new Error('Bad Request'), {
      debugInfo: {
        fieldPath: 'tools[3].input_schema.properties.foo',
      },
      // body sometimes has the tool list referenced here:
      requestBody: {
        tools: [
          { name: 'a' },
          { name: 'b' },
          { name: 'c' },
          { name: 'broken_tool' },
          { name: 'e' },
        ],
      },
    });
    expect(parseSchemaRejectionToolName(err)).toBe('broken_tool');
  });

  it('extracts via message containing tool name', () => {
    const err = new Error(
      'tool "gmail__list_messages" has invalid JSON schema: field "foo" not allowed in draft-07',
    );
    expect(parseSchemaRejectionToolName(err)).toBe('gmail__list_messages');
  });

  it('returns null when no signal of a schema rejection is present', () => {
    expect(parseSchemaRejectionToolName(new Error('Internal Server Error'))).toBeNull();
  });
});

describe('removeFailingTool', () => {
  it('removes the named key and returns a new object', () => {
    const tools = { a: 1, b: 2, c: 3 };
    const cleaned = removeFailingTool(tools, 'b');
    expect(cleaned).toEqual({ a: 1, c: 3 });
    // Original untouched (defensive — caller may keep a reference).
    expect(tools).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('is a no-op when the key is absent', () => {
    const tools = { a: 1 };
    expect(removeFailingTool(tools, 'missing')).toEqual({ a: 1 });
  });
});

describe('makeMcpSchemaRetryHandler', () => {
  it('defaults max retries to 5', () => {
    const handler = makeMcpSchemaRetryHandler();
    expect(handler.max).toBe(5);
  });

  it('shouldRetry returns true until max is reached', () => {
    const handler = makeMcpSchemaRetryHandler({ max: 5 });
    for (let i = 0; i < 5; i++) {
      expect(handler.shouldRetry()).toBe(true);
    }
    expect(handler.shouldRetry()).toBe(false);
  });

  it('reset() restores attempts to 0', () => {
    const handler = makeMcpSchemaRetryHandler({ max: 2 });
    handler.shouldRetry();
    handler.shouldRetry();
    handler.reset();
    expect(handler.shouldRetry()).toBe(true);
  });
});
