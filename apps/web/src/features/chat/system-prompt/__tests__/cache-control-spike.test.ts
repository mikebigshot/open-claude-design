/**
 * Spike findings (2026-05-01) — cache_control transport via OpenRouter (R1)
 * ============================================================================
 *
 * SDK shape exploration results:
 *
 * 1. `generateText` accepts `system?: string | SystemModelMessage | Array<SystemModelMessage>`.
 *    The `messages` array param does NOT have a `role:'system'` member with providerOptions
 *    at the top-level call — system content goes through the `system` param.
 *
 * 2. `SystemModelMessage` (from `@ai-sdk/provider-utils`) is:
 *    ```ts
 *    type SystemModelMessage = {
 *      role: 'system';
 *      content: string;
 *      providerOptions?: ProviderOptions; // Record<string, Record<string, JSONValue>>
 *    }
 *    ```
 *    This is the correct carrier for per-message `providerOptions.anthropic.cacheControl`.
 *    The task description's `messages:[{role:'system', content:..., providerOptions:{…}}]` syntax
 *    is valid when passed through the `system` param (not the `messages` array), or when
 *    the `allowSystemInMessages` flag is used. Using `system:` param with SystemModelMessage
 *    is the idiomatic path.
 *
 * 3. OpenRouter `@openrouter/ai-sdk-provider@^2.9.0` has TWO cache mechanisms:
 *    a) Top-level `cache_control` in `OpenRouterSharedSettings` (request body level,
 *       automatic caching via `providerOptions: { openrouter: { cache_control: { type:'ephemeral' } } }`).
 *    b) Per-message `providerOptions.anthropic.cacheControl` — forwarded to Anthropic's
 *       per-block cache_control if OpenRouter passes it through. The `OpenRouterProviderOptions`
 *       type does NOT include `cacheControl`, so Anthropic per-message cache_control goes
 *       under the `anthropic` key (not `openrouter`). This is the approach we test here.
 *
 * 4. `ToolLoopAgent.instructions` also accepts `SystemModelMessage | Array<SystemModelMessage>`,
 *    so the same providerOptions.anthropic.cacheControl pattern works for the agent case.
 *
 * 5. Usage field names: Vercel AI SDK returns token counts as `usage.inputTokens` /
 *    `usage.outputTokens`. Provider-specific fields like `cachedInputTokens` /
 *    `cacheReadInputTokens` / `cache_read_input_tokens` may appear in provider metadata
 *    rather than the top-level `usage` object — the test probes all known variants.
 *
 * Concerns for the human to verify during live run:
 * - "anthropic/claude-haiku-4-5" may not be the correct OpenRouter slug; the canonical
 *   slug may be "anthropic/claude-haiku-3-5" or similar. Check https://openrouter.ai/models.
 * - Anthropic prompt cache requires ≥1024 tokens to be cache-eligible. The padding here
 *   (~1000 tokens) is borderline — bumped to repeat(600) (~1500 tokens) for safety.
 * - If cache_read_input_tokens is 0 on the second call, OpenRouter may not be forwarding
 *   the per-message providerOptions.anthropic.cacheControl through to Anthropic. In that
 *   case, try the top-level approach:
 *   `providerOptions: { openrouter: { cache_control: { type: 'ephemeral' } } }`
 *   at the generateText call level. That uses Anthropic automatic prompt caching.
 * - The test has a fallback: it also logs the raw `providerMetadata` field so the human
 *   can see exactly what the provider returns.
 */

import { describe, it, expect } from 'vitest';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { SystemModelMessage } from '@ai-sdk/provider-utils';

const apiKey = process.env.OPENROUTER_API_KEY;
const SHOULD_RUN = !!apiKey;

// Minimum ~1500 tokens to comfortably exceed Anthropic's 1024-token cache threshold.
const PADDING = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(600);

describe.skipIf(!SHOULD_RUN)('cache_control spike (live, requires OPENROUTER_API_KEY)', () => {
  it('passes cacheControl through to Anthropic and reports cache hit/miss', async () => {
    const openrouter = createOpenRouter({ apiKey: apiKey! });

    const systemMsg: SystemModelMessage = {
      role: 'system',
      content: `You are a test bot. ${PADDING}`,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    };

    // First call — populates cache
    const r1 = await generateText({
      model: openrouter('anthropic/claude-haiku-3-5'),
      system: systemMsg,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    });

    // Second call — should hit cache
    const r2 = await generateText({
      model: openrouter('anthropic/claude-haiku-3-5'),
      system: systemMsg,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    });

    // eslint-disable-next-line no-console
    console.log('SPIKE r1 text:', r1.text);
    // eslint-disable-next-line no-console
    console.log('SPIKE r1 usage:', JSON.stringify(r1.usage));
    // eslint-disable-next-line no-console
    console.log('SPIKE r1 providerMetadata:', JSON.stringify(r1.providerMetadata));
    // eslint-disable-next-line no-console
    console.log('SPIKE r2 text:', r2.text);
    // eslint-disable-next-line no-console
    console.log('SPIKE r2 usage:', JSON.stringify(r2.usage));
    // eslint-disable-next-line no-console
    console.log('SPIKE r2 providerMetadata:', JSON.stringify(r2.providerMetadata));

    expect(r1.text.trim()).toMatch(/OK/i);
    expect(r2.text.trim()).toMatch(/OK/i);

    // Probe all known field name variants that Anthropic / OpenRouter / Vercel AI SDK
    // might use to report cache-read tokens:
    type AnyUsage = {
      cachedInputTokens?: number;
      cacheReadInputTokens?: number;
      cache_read_input_tokens?: number;
    };
    const u2 = r2.usage as unknown as AnyUsage;
    const cacheRead =
      u2.cachedInputTokens ??
      u2.cacheReadInputTokens ??
      u2.cache_read_input_tokens ??
      // Also check providerMetadata (Anthropic often puts it there)
      (r2.providerMetadata?.anthropic as AnyUsage | undefined)?.cachedInputTokens ??
      (r2.providerMetadata?.anthropic as AnyUsage | undefined)?.cacheReadInputTokens ??
      (r2.providerMetadata?.anthropic as AnyUsage | undefined)?.cache_read_input_tokens ??
      0;

    expect(
      cacheRead,
      'Expected cache_read_input_tokens > 0 on second call. If this fails, ' +
        'cache_control is not being forwarded through OpenRouter → Anthropic. ' +
        'Check providerMetadata logs above for the actual field name.',
    ).toBeGreaterThan(0);
  }, 30_000);
});
