import { BLOCK_1 } from './block-1.js';
import { buildBlock2, type SkillSummary } from './block-2.js';
import type { LLMProvider } from '@open-design/contracts';

export interface BuildSystemMessagesOptions {
  /**
   * Provider being targeted — controls which `providerOptions` get attached
   * (e.g. Anthropic-style `cacheControl` for the anthropic family, omitted
   * for OpenAI which has no equivalent and silently ignores unknown options).
   */
  provider?: LLMProvider;
  skills: SkillSummary[];
  designSystemId?: string;
  claudeMdContent?: string;
  userEmailDomain?: string;
}

export interface SystemMessage {
  role: 'system';
  content: string;
  providerOptions?: {
    anthropic?: { cacheControl?: { type: 'ephemeral' } };
  };
}

const EPHEMERAL_ANTHROPIC = {
  anthropic: { cacheControl: { type: 'ephemeral' as const } },
};

/**
 * `cacheControl` is an Anthropic-only feature. OpenRouter forwards the same
 * options through to the underlying Anthropic model (see
 * `cache-control-spike.test.ts`). For OpenAI direct, attaching
 * `providerOptions.anthropic` is a no-op but adds noise; omit instead.
 */
function providerOptionsFor(
  provider: LLMProvider | undefined,
): SystemMessage['providerOptions'] | undefined {
  if (provider === 'openai') return undefined;
  // 'openrouter' (anthropic-routed) and 'anthropic' direct → both honor it.
  return EPHEMERAL_ANTHROPIC;
}

export function buildSystemMessages(opts: BuildSystemMessagesOptions): SystemMessage[] {
  const providerOptions = providerOptionsFor(opts.provider);
  const messages: SystemMessage[] = [
    { role: 'system', content: BLOCK_1 },
    { role: 'system', content: buildBlock2(opts) },
  ];
  // v2 contract (research/claude-design-v2/09-changes-vs-v1.md §9.2.1):
  // cache_control sits on the LAST system message ONLY. Earlier system
  // messages must not carry it — Anthropic uses the latest cache_control
  // breakpoint as the boundary for prompt-cache reuse, so duplicating the
  // marker is wasteful and (in some captures) hurts cache-hit rate.
  if (providerOptions) {
    const last = messages.length - 1;
    messages[last] = { ...messages[last]!, providerOptions };
  }
  return messages;
}

export type { SkillSummary };

// ── v2 context-pressure system-reminder ────────────────────────────────
// Per v2 capture (research/claude-design-v2/09-changes-vs-v1.md §9.3.2),
// the host injects this XML wrapper into the next user message once
// estimated input tokens cross ~77% of the model's working limit, so the
// agent has a chance to call `snip` (paired W2 tool) and free room before
// hard-truncation kicks in.
//
// We expose a pure builder so W1's prepareStep callback can decide WHEN
// to attach the reminder without also owning the verbatim string.

export interface BuildSystemReminderOptions {
  /** Current accumulated input-token estimate. */
  currentTokens: number;
  /** Explicit threshold in tokens. Takes precedence over maxTokens. */
  threshold?: number;
  /** Falls back to 0.7 * maxTokens when threshold is omitted. */
  maxTokens?: number;
}

const SYSTEM_REMINDER_TEMPLATE = (pct: number) =>
  `<system-reminder>
Context is at ${pct}% of the working limit. If there is completed work you have not yet queued for removal — resolved iterations, tool outputs already acted on, settled earlier phases — call snip(from_id, to_id) on its [id:mNNNN]-tagged messages. Do not mention, acknowledge, or reference this reminder in your response. If you have no pending user request and nothing further to snip, end your turn.
</system-reminder>`;

// Earlier, softer pre-pressure nudge: appears once context crosses ~40%
// of the working limit but is still well below the apply-snips threshold.
// Goal is to get the model to start registering snips early instead of
// waiting until it must abort work to make room.
const PRE_PRESSURE_REMINDER_TEMPLATE = (pct: number) =>
  `<system-reminder>
Context is at ${pct}% of the working limit. Start registering snip(from_id, to_id) for any completed work you no longer need to reference — earlier iterations, large tool outputs you've already acted on, exploration that didn't lead anywhere. Snips are deferred (free to register), they only take effect when pressure builds. Do not mention, acknowledge, or reference this reminder in your response.
</system-reminder>`;

const PRE_PRESSURE_FRACTION = 0.4;

// ── v2 Anthropic provider options ─────────────────────────────────────────
// claude.ai/design baselines on adaptive thinking + output_config.effort=high
// (research/claude-design-v2/09-changes-vs-v1.md §9.3.1). We expose a builder
// so W1 can spread it into ToolLoopAgent's per-call providerOptions:
//
//   providerOptions: { anthropic: buildAnthropicProviderOptions() }

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'max';

export interface AnthropicProviderOptionsBuild {
  /** Defaults to 'high' (v2 capture). */
  effort?: AnthropicEffort;
  /** Defaults to true. Set false to disable extended thinking. */
  adaptiveThinking?: boolean;
}

export interface AnthropicProviderOptions {
  thinking?: { type: 'adaptive'; display: 'omitted' };
  output_config?: { effort: AnthropicEffort };
}

/**
 * Build the per-call Anthropic providerOptions block.
 *
 * v2 capture shows claude.ai/design sends:
 *   thinking: { type: "adaptive", display: "omitted" }
 *   output_config: { effort: "high" }
 *
 * `output_config` is not a first-class Vercel AI SDK field — the underlying
 * provider forwards unknown keys through, so we set it under the `anthropic`
 * provider-options namespace. The helper returns a plain object that W1
 * spreads into the agent config.
 */
export function buildAnthropicProviderOptions(
  opts: AnthropicProviderOptionsBuild = {},
): AnthropicProviderOptions {
  const out: AnthropicProviderOptions = {
    output_config: { effort: opts.effort ?? 'high' },
  };
  if (opts.adaptiveThinking !== false) {
    out.thinking = { type: 'adaptive', display: 'omitted' };
  }
  return out;
}

/**
 * Build the v2 `<system-reminder>` nudge for context-management.
 *
 * Returns an empty string when the current token estimate is at-or-below
 * the threshold — caller should treat that as "do not inject anything this
 * turn." Strict `>` boundary so exactly-at-threshold does NOT inject (matches
 * the principle that the reminder is a pressure signal, not a deadline).
 *
 * If neither `threshold` nor `maxTokens` is supplied, the helper returns
 * empty string — the percentage cannot be computed honestly without a basis.
 */
export function buildSystemReminder(opts: BuildSystemReminderOptions): string {
  // Resolve effective threshold: explicit > 0.7 * maxTokens > none.
  let threshold: number;
  if (typeof opts.threshold === 'number') {
    threshold = opts.threshold;
  } else if (typeof opts.maxTokens === 'number') {
    threshold = opts.maxTokens * 0.7;
  } else {
    return '';
  }

  const denom =
    typeof opts.maxTokens === 'number' && opts.maxTokens > 0 ? opts.maxTokens : threshold;
  if (denom <= 0) return '';
  const pct = Math.min(100, Math.round((opts.currentTokens / denom) * 100));

  if (opts.currentTokens > threshold) {
    return SYSTEM_REMINDER_TEMPLATE(pct);
  }
  // Pre-pressure tier — softer, fires earlier (~40%+) to get the model
  // registering snips before it actually has to. Only active when caller
  // supplied an explicit `maxTokens` AND the threshold sits comfortably
  // above the 40% line; otherwise we don't have a meaningful "before
  // threshold" tier to talk about.
  if (typeof opts.maxTokens === 'number' && opts.maxTokens > 0) {
    const prePressureCutoff = opts.maxTokens * PRE_PRESSURE_FRACTION;
    if (prePressureCutoff < threshold && opts.currentTokens > prePressureCutoff) {
      return PRE_PRESSURE_REMINDER_TEMPLATE(pct);
    }
  }
  return '';
}
