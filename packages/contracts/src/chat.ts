// Chat-related types — browser-side agent path.
// Worker never sees chat traffic.

/**
 * LLM provider the chat agent talks to. BYOK: each provider gets its own
 * localStorage-stored API key; only the *current* provider's key is sent
 * with chat requests. Worker never sees keys.
 *
 * Vercel AI SDK is the multi-provider abstraction layer; we just branch
 * `createAgent()` on this enum.
 */
export type LLMProvider =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'moonshot'
  | 'alibaba'
  | 'xai'
  | 'mistral'
  | 'deepseek'
  | 'groq'
  | 'cohere'
  | 'cerebras'
  | 'vercel'
  | 'huggingface'
  | 'baseten';

export const PROVIDERS: readonly LLMProvider[] = [
  'openrouter',
  'anthropic',
  'openai',
  'google',
  // Promoted ahead of the long tail because Chinese users often reach for
  // Moonshot (Kimi) / Alibaba (Qwen) first.
  'moonshot',
  'alibaba',
  'xai',
  'mistral',
  'deepseek',
  'groq',
  'cohere',
  'cerebras',
  'vercel',
  'huggingface',
  'baseten',
] as const;

export const PROVIDER_LABELS: Readonly<Record<LLMProvider, string>> = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  moonshot: 'Moonshot (Kimi)',
  alibaba: 'Alibaba (Qwen)',
  xai: 'xAI Grok',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  cohere: 'Cohere',
  cerebras: 'Cerebras',
  vercel: 'Vercel (v0)',
  huggingface: 'Hugging Face',
  baseten: 'Baseten',
};

/**
 * URL the user visits to mint a key for each provider — surfaced in
 * `ApiKeyForm` as a "Get key →" link beside the input.
 */
export const PROVIDER_KEY_URLS: Readonly<Record<LLMProvider, string>> = {
  openrouter: 'https://openrouter.ai/keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
  moonshot: 'https://platform.moonshot.cn/console/api-keys',
  alibaba: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
  xai: 'https://console.x.ai',
  mistral: 'https://console.mistral.ai/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  groq: 'https://console.groq.com/keys',
  cohere: 'https://dashboard.cohere.com/api-keys',
  cerebras: 'https://cloud.cerebras.ai/platform/keys',
  vercel: 'https://v0.dev/chat/settings/keys',
  huggingface: 'https://huggingface.co/settings/tokens',
  baseten: 'https://app.baseten.co/settings/api_keys',
};

export interface ModelInfo {
  /**
   * Provider-native id passed verbatim to the SDK (e.g. `gpt-4o` for OpenAI,
   * `anthropic/claude-sonnet-4-6` for OpenRouter, `claude-sonnet-4-6` for
   * Anthropic direct). Same shortname can appear under multiple providers
   * with different prefixes — always pair `id` with `provider` to disambiguate.
   */
  readonly id: string;
  readonly label: string;
  readonly provider: LLMProvider;
}

/**
 * Single source of truth for the model picker. Adding a new model: append
 * one entry; ModelDropdown groups by provider and `defaultModelForProvider()`
 * picks the first entry under each provider as that provider's default.
 */
export const MODELS: readonly ModelInfo[] = [
  // OpenRouter — aggregator that proxies to Anthropic/OpenAI/etc. Default
  // because it's the lowest-friction onramp (one key covers many models).
  // First entry per provider doubles as that provider's `defaultModelFor*`
  // — keep Sonnet 4.6 first so it matches DEFAULT_MODEL_ID.
  { id: 'anthropic/claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'openrouter' },
  { id: 'anthropic/claude-opus-4-7', label: 'Opus 4.7', provider: 'openrouter' },
  { id: 'anthropic/claude-sonnet-4-5', label: 'Sonnet 4.5', provider: 'openrouter' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Haiku 4.5', provider: 'openrouter' },
  { id: 'openai/gpt-4o', label: 'GPT-4o (via OR)', provider: 'openrouter' },
  // Anthropic direct — browser → api.anthropic.com via @ai-sdk/anthropic
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', provider: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', provider: 'anthropic' },
  // OpenAI direct
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', provider: 'openai' },
  { id: 'gpt-5', label: 'GPT-5', provider: 'openai' },
  // Google (Gemini)
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google' },
  // xAI Grok
  { id: 'grok-4', label: 'Grok 4', provider: 'xai' },
  { id: 'grok-4-fast-reasoning', label: 'Grok 4 Fast (reasoning)', provider: 'xai' },
  { id: 'grok-3', label: 'Grok 3', provider: 'xai' },
  { id: 'grok-3-mini', label: 'Grok 3 mini', provider: 'xai' },
  // Mistral
  { id: 'mistral-large-latest', label: 'Mistral Large', provider: 'mistral' },
  { id: 'mistral-small-latest', label: 'Mistral Small', provider: 'mistral' },
  // DeepSeek
  { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek' },
  // Groq (fast inference for open-weight models)
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', provider: 'groq' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'groq' },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout 17B',
    provider: 'groq',
  },
  // Cohere
  { id: 'command-a-03-2025', label: 'Command A', provider: 'cohere' },
  { id: 'command-a-reasoning-08-2025', label: 'Command A (reasoning)', provider: 'cohere' },
  { id: 'command-r-plus', label: 'Command R+', provider: 'cohere' },
  { id: 'command-r', label: 'Command R', provider: 'cohere' },
  // Cerebras (open-weight models on bespoke fast inference)
  { id: 'llama3.3-70b', label: 'Llama 3.3 70B', provider: 'cerebras' },
  { id: 'gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'cerebras' },
  { id: 'qwen-3-32b', label: 'Qwen 3 32B', provider: 'cerebras' },
  // Vercel v0 (web-app code generation model)
  { id: 'v0-1.0-md', label: 'v0 1.0 (medium)', provider: 'vercel' },
  // Moonshot AI (Kimi) — China-friendly: hits api.moonshot.cn directly.
  { id: 'kimi-k2.5', label: 'Kimi K2.5', provider: 'moonshot' },
  { id: 'kimi-k2-0905-preview', label: 'Kimi K2 (0905)', provider: 'moonshot' },
  { id: 'kimi-k2-thinking', label: 'Kimi K2 (thinking)', provider: 'moonshot' },
  // Alibaba Qwen via DashScope (compatible-mode endpoint, China region).
  { id: 'qwen3-max', label: 'Qwen3 Max', provider: 'alibaba' },
  { id: 'qwen-plus', label: 'Qwen Plus', provider: 'alibaba' },
  { id: 'qwen-turbo', label: 'Qwen Turbo', provider: 'alibaba' },
  // Hugging Face Inference Router (OpenAI-compatible).
  {
    id: 'meta-llama/Llama-3.1-8B-Instruct',
    label: 'Llama 3.1 8B Instruct',
    provider: 'huggingface',
  },
  { id: 'moonshotai/Kimi-K2-Instruct', label: 'Kimi K2 Instruct', provider: 'huggingface' },
  // Baseten Model APIs (OpenAI-compatible).
  {
    id: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    label: 'Qwen3 235B',
    provider: 'baseten',
  },
  { id: 'deepseek-ai/DeepSeek-V3.1', label: 'DeepSeek V3.1', provider: 'baseten' },
  {
    id: 'moonshotai/Kimi-K2-Instruct-0905',
    label: 'Kimi K2 (0905)',
    provider: 'baseten',
  },
];

/**
 * Loose model-id type. We can't use a string-literal union here because
 * model ids collide across providers (`claude-sonnet-4-6` exists under both
 * `anthropic` and — minus the prefix — semantically under `openrouter` too).
 * Always pair with an `LLMProvider` to disambiguate.
 */
export type ChatModelId = string;

/** Back-compat alias — call sites used `ChatModel` before multi-provider. */
export type ChatModel = ChatModelId;

export const DEFAULT_PROVIDER: LLMProvider = 'openrouter';
export const DEFAULT_MODEL_ID: ChatModelId = 'anthropic/claude-sonnet-4-6';

/** Models registered for a given provider, in MODELS-array order. */
export function modelsForProvider(provider: LLMProvider): readonly ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}

/** First registered model for the provider — used as that provider's default. */
export function defaultModelForProvider(provider: LLMProvider): ChatModelId {
  return modelsForProvider(provider)[0]?.id ?? DEFAULT_MODEL_ID;
}

/** Whether (provider, id) names a registered model. */
export function isValidModelForProvider(provider: LLMProvider, id: string): boolean {
  return MODELS.some((m) => m.provider === provider && m.id === id);
}

export type ContentBlock =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}
