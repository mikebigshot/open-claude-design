// snip — register `[id:mNNNN]` ranges of conversation history for deferred
// removal. Snip is a *registration* system, not immediate deletion. W1's
// prepareStep callback drains pending registrations when token usage approaches
// the model's context limit.
//
// Source v2 verbatim: artifacts/tool-implementations/snip.js
//   - description text MUST match v2 (LLM relies on the exact phrasing for
//     "RegisterMANY snips. After finishing any distinct chunk of work, ...")
//   - input_schema fields: { from_id, to_id, reason? } — required: [from_id, to_id]
//   - return: `Snip registered (N queued).` where N = un-consumed registrations
//
// Cross-cutting: getRegisteredSnips / markSnipsConsumed / clearSnipRegistry
// are exported for W1 (prepareStep) to consume.

import { tool } from 'ai';
import { z } from 'zod';

const SNIP_DESCRIPTION = `Mark a range of conversation history for deferred removal.

Each user message ends with an [id:mNNNN] tag. Copy the exact tag values as from_id and to_id — do not guess IDs, find the actual tags on the messages you want to remove. Both IDs are inclusive: snip({from_id: "m0003", to_id: "m0007"}) removes m0003 through m0007. To remove a single message, use the same ID for both.

Snips are a REGISTRATION system, not immediate deletion. Registering is cheap and non-destructive — messages stay visible until context pressure builds, then all registered snips execute together. Register aggressively and early.

Register MANY snips. After finishing any distinct chunk of work, immediately register a snip for it. Good candidates: resolved explorations, completed multi-step operations whose intermediate steps are no longer needed, long tool outputs that have been acted upon, earlier drafts superseded by later versions.

You can call this multiple times to mark different ranges. Snipped content is silently removed with no placeholder — capture anything you still need (in a summary, file, or your response) before snipping.`;

export interface RegisteredSnip {
  fromId: string;
  toId: string;
  reason?: string;
  registeredAt: number;
  /** Set true by markSnipsConsumed() once W1 has applied the snip to messages. */
  consumed: boolean;
}

const REGISTRY: Map<string, RegisteredSnip[]> = new Map();

/** Read-only view of pending + consumed snips for a chat. */
export function getRegisteredSnips(chatId: string): RegisteredSnip[] {
  return REGISTRY.get(chatId) ?? [];
}

/** Mark every snip in this chat as consumed (post W1 prepareStep apply). */
export function markSnipsConsumed(chatId: string): void {
  const list = REGISTRY.get(chatId);
  if (!list) return;
  for (const s of list) s.consumed = true;
}

/** Drop registry for one chat (or all chats when chatId is omitted). */
export function clearSnipRegistry(chatId?: string): void {
  if (chatId === undefined) {
    REGISTRY.clear();
    return;
  }
  REGISTRY.delete(chatId);
}

/** Internal: append a snip. Used by `snipTool` and tests. */
export function _registerSnip(
  chatId: string,
  fromId: string,
  toId: string,
  reason?: string,
): { totalQueued: number } {
  const list = REGISTRY.get(chatId) ?? [];
  list.push({
    fromId,
    toId,
    reason,
    registeredAt: Date.now(),
    consumed: false,
  });
  REGISTRY.set(chatId, list);
  return { totalQueued: list.filter((s) => !s.consumed).length };
}

export interface SnipContext {
  /** Caller-provided chat id getter (executes per-call so callers can swap chat). */
  getChatId: () => string;
}

export function snipTool(ctx: SnipContext) {
  return tool({
    description: SNIP_DESCRIPTION,
    inputSchema: z.object({
      from_id: z
        .string()
        .describe(
          'The [id:...] tag value from the first user message to snip, inclusive (copy exactly, e.g. "m0003")',
        ),
      to_id: z
        .string()
        .describe(
          'The [id:...] tag value from the last user message to snip, inclusive (copy exactly, e.g. "m0007")',
        ),
      reason: z
        .string()
        .optional()
        .describe('Brief note on why this range is no longer needed (optional, for telemetry)'),
    }),
    execute: async ({ from_id, to_id, reason }, { messages }) => {
      const chatId = ctx.getChatId();
      // Extract all [id:mNNNN] tags from the message history so we can catch
      // hallucinated IDs at register time (matches official's `qx(chatId,id)`
      // WeakRef reverse lookup, but operating on the AI SDK `messages` arg).
      const validIds = collectMessageIds(messages);
      if (validIds.size > 0) {
        const missing: string[] = [];
        if (!validIds.has(from_id)) missing.push(`from_id="${from_id}"`);
        if (from_id !== to_id && !validIds.has(to_id)) missing.push(`to_id="${to_id}"`);
        if (missing.length > 0) {
          const sample = Array.from(validIds).slice(0, 10).join(', ');
          const total = validIds.size;
          const more = total > 10 ? ` (and ${total - 10} more)` : '';
          return `Error: snip id not found (${missing.join(', ')}). Valid IDs (${total} total): ${sample}${more}. Copy the exact [id:mNNNN] tag from a user message — do not guess.`;
        }
      }
      const { totalQueued } = _registerSnip(chatId, from_id, to_id, reason);
      return `Snip registered (${totalQueued} queued).`;
    },
  });
}

/** Walk AI SDK 6 message parts and pluck every `[id:mNNNN]` tag value. */
function collectMessageIds(messages: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(messages)) return ids;
  const ID_REGEX = /\[id:([^\]]+)\]/g;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const content = (msg as { content?: unknown }).content;
    if (typeof content === 'string') {
      for (const m of content.matchAll(ID_REGEX)) ids.add(m[1]!);
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        const text =
          part && typeof part === 'object' && 'text' in part
            ? (part as { text?: unknown }).text
            : undefined;
        if (typeof text === 'string') {
          for (const m of text.matchAll(ID_REGEX)) ids.add(m[1]!);
        }
      }
    }
  }
  return ids;
}
