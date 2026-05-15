// recoverPartialState — §2.10 helper.
//
// When the user clicks Stop mid-stream, AI SDK 6's chat.stop() aborts the
// underlying request but leaves any partial assistant message in
// chat.messages. Tool parts may sit in non-terminal states
// ('input-streaming' or 'input-available') without matching tool_results,
// which confuses the LLM on the next sendMessage (it sees tool_use blocks
// without follow-on results).
//
// We synthesize an aborted tool_result for each such orphan so the next
// API call sees a closed shape.
//
// v2 reference: main-agent-loop-full.raw.js — `Une(...)` (called from the
// catch block when AbortError fires) walks the assistant message's content
// and emits matching tool_result blocks for any tool_use that's missing
// one. We do the same at the UI-message level since AI SDK's UIMessage
// shape is what use-agent-chat sees.

// We accept any object whose `parts` is iterable + has the `type` /
// `state` shape. Loose typing is intentional here because callers (test
// fixtures, AI SDK 6's UIMessage) carry extra typed fields we don't want
// to enumerate. The runtime check above is what gates behavior.
interface UIPart {
  type: string;
  state?: string;
  toolCallId?: string;
  output?: unknown;
}

interface MessageLike {
  role: string;
  parts: UIPart[];
}

const PARTIAL_STATES = new Set(['input-streaming', 'input-available']);
const SYNTHETIC_OUTPUT = {
  aborted: true,
  message: 'Tool call cancelled by user.',
} as const;

export function recoverPartialState<TMsg extends MessageLike>(
  messages: readonly TMsg[],
): { messages: TMsg[]; recovered: boolean } {
  let recovered = false;
  const out: TMsg[] = messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    let touched = false;
    const newParts = msg.parts.map((part) => {
      const looksLikeTool = typeof part.type === 'string' && part.type.startsWith('tool-');
      if (!looksLikeTool) return part;
      if (typeof part.state !== 'string' || !PARTIAL_STATES.has(part.state)) {
        return part;
      }
      touched = true;
      return {
        ...part,
        state: 'output-available' as const,
        output: SYNTHETIC_OUTPUT,
      };
    });
    if (!touched) return msg;
    recovered = true;
    return { ...msg, parts: newParts };
  });
  return { messages: out, recovered };
}
