// Stub — Step 2 (§2.6) implements `__async` placeholder protocol.
// Anthropic's main agent loop sees a `{__async: true, _execute, _label,
// _toolName, placeholder}` object returned from a tool's execute() and:
//   1. Schedules `_execute` to run in the background.
//   2. Returns `placeholder` as the synchronous tool_result so the LLM
//      sees the marker text and ends its turn.
//   3. When `_execute` resolves, the result is fed back as a NEW user
//      message (not as a follow-on tool_result).
//
// Placeholder until the Step 2 TDD pass fills this in.

export const ASYNC_PROTOCOL_KEY = '__async' as const;

/** Spec object returned by an async tool. */
export interface AsyncToolResultSpec<TLabel extends string = string> {
  readonly __async: true;
  readonly _toolName: string;
  readonly _label: TLabel;
  readonly placeholder: string;
}

export function isAsyncToolResult(value: unknown): value is AsyncToolResultSpec {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v[ASYNC_PROTOCOL_KEY] === true && typeof v._toolName === 'string';
}

export function extractAsyncSpec(value: unknown): AsyncToolResultSpec | null {
  return isAsyncToolResult(value) ? (value as AsyncToolResultSpec) : null;
}
