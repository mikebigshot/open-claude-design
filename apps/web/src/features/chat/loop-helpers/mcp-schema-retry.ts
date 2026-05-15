// mcp-schema-retry — §2.3 helper.
//
// Third-party MCP servers occasionally return tools whose `inputSchema` the
// underlying provider rejects (Anthropic enforces draft-07 strict mode +
// some structural rules). When that happens, the entire turn dies because
// the API call returns a 400 before any text streams. v2 catches the error,
// parses the failing tool name out of `debugInfo.fieldPath`, removes that
// tool from the next request, and retries up to 5 times.
//
// Our chain uses Vercel AI SDK 6 → @ai-sdk/anthropic → fetch. The thrown
// error is a `LanguageModelError` with `debugInfo.fieldPath` and sometimes
// `debugInfo.toolName`. We try multiple extraction strategies in order of
// reliability.

const FIELD_PATH_TOOLS_INDEX_RE = /^tools\[(\d+)\]/;
const TOOL_NAME_IN_MESSAGE_RE = /tool[\s_-]?(?:name)?\s*[:=]?\s*["']([^"']+)["']/i;

interface ErrorWithDebugInfo {
  debugInfo?: {
    toolName?: unknown;
    fieldPath?: unknown;
  };
  requestBody?: {
    tools?: Array<{ name?: unknown }>;
  };
  message?: unknown;
  cause?: unknown;
}

export function parseSchemaRejectionToolName(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as ErrorWithDebugInfo;

  // 1. Direct `debugInfo.toolName` (AI SDK or downstream may set this).
  const direct = e.debugInfo?.toolName;
  if (typeof direct === 'string' && direct.length > 0) return direct;

  // 2. `debugInfo.fieldPath` shaped like `tools[3].input_schema...`. We need
  //    the requestBody.tools list to map index → name.
  const fieldPath = e.debugInfo?.fieldPath;
  if (typeof fieldPath === 'string') {
    const m = FIELD_PATH_TOOLS_INDEX_RE.exec(fieldPath);
    if (m && e.requestBody?.tools) {
      const idx = Number(m[1]);
      const t = e.requestBody.tools[idx];
      if (t && typeof t.name === 'string') return t.name;
    }
  }

  // 3. Best-effort: regex over the message.
  if (typeof e.message === 'string') {
    const m = TOOL_NAME_IN_MESSAGE_RE.exec(e.message);
    if (m) return m[1] ?? null;
  }

  // 4. Recurse into `cause` if present.
  if (e.cause) {
    return parseSchemaRejectionToolName(e.cause);
  }

  return null;
}

export function removeFailingTool<T extends Record<string, unknown>>(
  tools: T,
  toolName: string,
): T {
  if (!(toolName in tools)) return { ...tools };
  const cleaned: Record<string, unknown> = {};
  for (const k of Object.keys(tools)) {
    if (k !== toolName) cleaned[k] = tools[k];
  }
  return cleaned as T;
}

export interface McpSchemaRetryHandler {
  readonly max: number;
  shouldRetry(): boolean;
  reset(): void;
}

export function makeMcpSchemaRetryHandler(opts: { max?: number } = {}): McpSchemaRetryHandler {
  const max = opts.max ?? 5;
  let attempts = 0;
  return {
    max,
    shouldRetry(): boolean {
      if (attempts >= max) return false;
      attempts += 1;
      return true;
    },
    reset(): void {
      attempts = 0;
    },
  };
}
