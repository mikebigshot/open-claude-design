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
  return [
    { role: 'system', content: BLOCK_1, providerOptions },
    { role: 'system', content: buildBlock2(opts), providerOptions },
  ];
}

export type { SkillSummary };
