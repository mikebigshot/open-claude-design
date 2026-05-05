// Model + provider preference — persisted in localStorage. Single source
// of truth for `(provider, modelId)` pairs lives in `@open-design/contracts`
// (PROVIDERS / MODELS / DEFAULT_*); this module just owns storage + reads.

import {
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  PROVIDERS,
  defaultModelForProvider,
  isValidModelForProvider,
  type ChatModelId,
  type LLMProvider,
} from '@open-design/contracts';

const PROVIDER_KEY = 'open-design.provider';
const MODEL_KEY = 'open-design.model';

export { DEFAULT_MODEL_ID as DEFAULT_MODEL };

export interface ModelPref {
  readonly provider: LLMProvider;
  readonly modelId: ChatModelId;
}

function isValidProvider(s: string): s is LLMProvider {
  return (PROVIDERS as readonly string[]).includes(s);
}

/** Read current (provider, model) from localStorage with safe fallbacks. */
export function getModelPref(): ModelPref {
  if (typeof localStorage === 'undefined') {
    return { provider: DEFAULT_PROVIDER, modelId: DEFAULT_MODEL_ID };
  }
  const rawProvider = localStorage.getItem(PROVIDER_KEY) ?? '';
  const provider: LLMProvider = isValidProvider(rawProvider) ? rawProvider : DEFAULT_PROVIDER;
  const rawModel = localStorage.getItem(MODEL_KEY) ?? '';
  // Legacy short ids ('claude-sonnet-4-5') from earlier ModelDropdown versions
  // → coerce to the openrouter slug. Only attempt for the openrouter provider.
  let candidate = rawModel;
  if (
    provider === 'openrouter' &&
    candidate &&
    !candidate.includes('/') &&
    candidate.startsWith('claude-')
  ) {
    candidate = `anthropic/${candidate}`;
  }
  const modelId: ChatModelId = isValidModelForProvider(provider, candidate)
    ? candidate
    : defaultModelForProvider(provider);
  return { provider, modelId };
}

export function setModelPref(pref: ModelPref): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PROVIDER_KEY, pref.provider);
    localStorage.setItem(MODEL_KEY, pref.modelId);
  } catch {
    /* private mode / disk full — best effort */
  }
}

// ---- Back-compat shims for call sites that pre-date multi-provider ---------

/** @deprecated Use getModelPref().modelId. */
export function getModelId(): ChatModelId {
  return getModelPref().modelId;
}

/**
 * @deprecated Use setModelPref({provider, modelId}). Resolves the provider
 * automatically by scanning PROVIDERS — kept for tests / legacy callers that
 * only know an id.
 */
export function setModelId(id: ChatModelId): void {
  for (const p of PROVIDERS) {
    if (isValidModelForProvider(p, id)) {
      setModelPref({ provider: p, modelId: id });
      return;
    }
  }
  // Unknown id → keep current provider, accept the id as user intent.
  setModelPref({ provider: getModelPref().provider, modelId: id });
}

/** Internal storage keys — exported for cross-tab sync only. */
export const MODEL_STORAGE_KEY = MODEL_KEY;
export const PROVIDER_STORAGE_KEY = PROVIDER_KEY;
