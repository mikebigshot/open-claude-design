// snip-applier — §2.1 algorithm: drop ranges of conversation history when
// the user (or v2's auto-trigger) registers a snip range. Each user message
// carries an `[id:mNNNN]` tag at its tail (added by use-agent-chat / chat
// activity builder); snip { from, to } removes every message in the
// half-open range [from..to] inclusive (user messages plus everything
// between).
//
// v2 reference: main-agent-loop-full.raw.js — `L4(M, r)` applies all
// registered snips for chat `r`, returns `{snipsApplied}`.

/** A single registered snip range. */
export interface RegisteredSnip {
  from: string;
  to: string;
  /** Optional reason captured at registration time (telemetry only). */
  reason?: string;
}

interface MessageLike {
  role: string;
  content: unknown;
}

/** Extract the trailing `[id:mNNNN]` tag from a user message's content. */
function extractIdTag(message: MessageLike): string | null {
  if (message.role !== 'user') return null;
  const text = stringifyContent(message.content);
  const m = /\[id:([^\]]+)\]\s*$/.exec(text);
  return m ? (m[1] ?? null) : null;
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let out = '';
    for (const part of content) {
      if (part && typeof part === 'object' && 'text' in part) {
        const t = (part as { text?: unknown }).text;
        if (typeof t === 'string') out += t;
      }
    }
    return out;
  }
  return '';
}

export function applyPendingSnips<TMsg extends MessageLike>(
  messages: readonly TMsg[],
  snips: readonly RegisteredSnip[],
): { messages: TMsg[]; snipsApplied: number } {
  if (snips.length === 0) {
    return { messages: [...messages], snipsApplied: 0 };
  }

  // Index each user message by its id tag, AND track the sorted user-msg
  // index list so we can find "next user msg after i_to" cheaply.
  const idToIndex = new Map<string, number>();
  const userMsgIndices: number[] = [];
  messages.forEach((msg, idx) => {
    if (msg.role !== 'user') return;
    userMsgIndices.push(idx);
    const tag = extractIdTag(msg);
    if (tag != null) idToIndex.set(tag, idx);
  });

  // Build a removal-mask in original-index space.
  const removeMask = new Array(messages.length).fill(false) as boolean[];
  let applied = 0;
  for (const snip of snips) {
    const i_from = idToIndex.get(snip.from);
    const i_to_user = idToIndex.get(snip.to);
    if (i_from == null || i_to_user == null) continue;
    if (i_from > i_to_user) continue;
    // Find the next user-msg index strictly after i_to_user. Everything up
    // to (but not including) that next user msg is part of the i_to user's
    // trailing assistant context and gets pulled along with it.
    const nextUserIdx = userMsgIndices.find((idx) => idx > i_to_user);
    const i_to = nextUserIdx != null ? nextUserIdx - 1 : messages.length - 1;
    for (let i = i_from; i <= i_to; i++) removeMask[i] = true;
    applied += 1;
  }

  if (applied === 0) {
    return { messages: [...messages], snipsApplied: 0 };
  }

  const out: TMsg[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (!removeMask[i]) {
      // we know it's defined because we're iterating up to messages.length
      out.push(messages[i] as TMsg);
    }
  }
  return { messages: out, snipsApplied: applied };
}
