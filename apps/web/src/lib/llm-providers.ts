// LLM provider routing — single place that maps `(provider, apiKey, modelId)`
// to a Vercel-AI-SDK `LanguageModelV2`. Used by both the chat agent
// (`features/chat/agent.ts`) and the iframe `window.claude.complete()`
// host handler (`lib/claude-complete.ts`).
//
// Vercel AI SDK *is* the abstraction. We only branch the constructor; we
// never wrap the returned model in our own interface.

import type { LanguageModel } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGroq } from '@ai-sdk/groq';
import { createCohere } from '@ai-sdk/cohere';
import { createCerebras } from '@ai-sdk/cerebras';
import { createVercel } from '@ai-sdk/vercel';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LLMProvider } from '@open-design/contracts';

/**
 * Hard-coded base URLs for providers that have no first-party `@ai-sdk/*`
 * package — we route them through `createOpenAICompatible`. The endpoints
 * below are chosen for **China network friendliness** where applicable
 * (Moonshot uses `.cn`, Alibaba DashScope uses the mainland host) so the
 * default works without extra config for the most-likely-affected users.
 */
const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<LLMProvider, string>> = {
  // Kimi — Moonshot China endpoint reachable from mainland w/o VPN.
  moonshot: 'https://api.moonshot.cn/v1',
  // Alibaba Qwen — DashScope OpenAI-compatible mode, mainland host.
  alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  // Hugging Face Inference Router exposes OpenAI-compatible /v1/chat/completions.
  huggingface: 'https://router.huggingface.co/v1',
  // Baseten Model APIs.
  baseten: 'https://inference.baseten.co/v1',
};

export function buildLanguageModel(
  provider: LLMProvider,
  apiKey: string,
  modelId: string,
): LanguageModel {
  switch (provider) {
    case 'openrouter': {
      return createOpenRouter({ apiKey })(modelId);
    }
    case 'anthropic': {
      // `anthropic-dangerous-direct-browser-access: true` opt-in is required
      // for Anthropic to accept browser-origin requests; without it CORS
      // blocks the call. Same risk profile as OpenRouter direct — user's
      // key, never sent to our worker.
      return createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(modelId);
    }
    case 'openai': {
      return createOpenAI({ apiKey })(modelId);
    }
    case 'google': {
      return createGoogleGenerativeAI({ apiKey })(modelId);
    }
    case 'xai': {
      return createXai({ apiKey })(modelId);
    }
    case 'mistral': {
      return createMistral({ apiKey })(modelId);
    }
    case 'deepseek': {
      return createDeepSeek({ apiKey })(modelId);
    }
    case 'groq': {
      return createGroq({ apiKey })(modelId);
    }
    case 'cohere': {
      return createCohere({ apiKey })(modelId);
    }
    case 'cerebras': {
      return createCerebras({ apiKey })(modelId);
    }
    case 'vercel': {
      return createVercel({ apiKey })(modelId);
    }
    case 'moonshot':
    case 'alibaba':
    case 'huggingface':
    case 'baseten': {
      const baseURL = OPENAI_COMPATIBLE_BASE_URLS[provider];
      // baseURL is statically defined above for every OpenAI-compatible
      // provider; the type narrowing just reflects the partial Record.
      if (!baseURL) throw new Error(`No baseURL configured for provider: ${provider}`);
      return createOpenAICompatible({ name: provider, baseURL, apiKey })(modelId);
    }
  }
}

/**
 * Fastest / cheapest model id for each provider — used by
 * `window.claude.complete()` (the iframe RPC) where latency and cost matter
 * more than ceiling capability.
 */
const FAST_MODEL_FOR_PROVIDER: Readonly<Record<LLMProvider, string>> = {
  openrouter: 'anthropic/claude-haiku-4-5',
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.5-flash',
  xai: 'grok-3-mini',
  mistral: 'mistral-small-latest',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
  cohere: 'command-r',
  cerebras: 'llama3.3-70b',
  vercel: 'v0-1.0-md',
  moonshot: 'kimi-k2.5',
  alibaba: 'qwen-turbo',
  huggingface: 'meta-llama/Llama-3.1-8B-Instruct',
  baseten: 'moonshotai/Kimi-K2-Instruct-0905',
};

export function buildFastModel(provider: LLMProvider, apiKey: string): LanguageModel {
  return buildLanguageModel(provider, apiKey, FAST_MODEL_FOR_PROVIDER[provider]);
}

/**
 * Provider capability matrix for Anthropic server tools (Phase 6).
 *
 * `web_fetch` is an Anthropic server tool — when the provider routes through
 * the Anthropic API (anthropic direct or openrouter passthrough on a Claude
 * model), the server fetches the URL, caches it, and emits citations. On
 * other providers we register our client-side worker-proxied fallback.
 */
const SERVER_TOOL_SUPPORT: Record<string, ReadonlySet<LLMProvider>> = {
  // OpenRouter forwards `tools` of type `web_search_20250305` / `web_fetch`
  // straight to the Anthropic API when the model is `anthropic/claude-*`.
  // Routing on a per-model basis at runtime needs an additional check
  // beyond just the provider, so right now we conservatively enable only
  // for `anthropic` direct.
  web_fetch: new Set<LLMProvider>(['anthropic']),
};

export function supportsServerTool(toolName: string, provider: LLMProvider): boolean {
  const set = SERVER_TOOL_SUPPORT[toolName];
  return set ? set.has(provider) : false;
}

/**
 * Build the map of provider-defined (server-executed) tools for the given
 * provider. The returned shape matches the AI SDK `tools` record: keys are
 * the tool names the model sees (`web_fetch`), values are provider-defined
 * tool descriptors (`type: 'provider-defined'`, `id: 'anthropic.web_fetch_*'`).
 *
 * Caller is expected to **merge** this into the regular client tool map
 * (the entries here override the client `web_fetch` so Anthropic-routed
 * requests get server-side fetch + citations instead of our worker proxy).
 *
 * Returns an empty map for providers without server-tool support — the
 * caller's regular client-side tools stay in place.
 */
export function buildServerToolMap(
  provider: LLMProvider,
  apiKey: string,
): Record<string, unknown> {
  if (provider !== 'anthropic') return {};
  // Same `dangerous-direct-browser-access` opt-in as buildLanguageModel —
  // server tools share auth with the language model call.
  const anthropicProvider = createAnthropic({
    apiKey,
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
  });
  return {
    // Use the newer 2026-02-09 release — current Claude models support it.
    // Older models (pre-2026-02-09) auto-downgrade server-side per Anthropic.
    web_fetch: anthropicProvider.tools.webFetch_20260209(),
  };
}
