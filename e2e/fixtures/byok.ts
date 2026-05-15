// BYOK key injection for tests.
//
// Storage shape mirrors apps/web/src/lib/byok-key.ts — `open-design:llm-api-key:<provider>`
// per provider. Provider preference + model preference live on the
// `open-design.provider` / `open-design.model` keys (apps/web/src/lib/model-pref.ts).
//
// We inject the key directly into the provider-specific slot (no reliance on
// the legacy-migration code path running first). Provider is derived from the
// model id where possible; tests can override via {provider}.

import type { Page } from '@playwright/test';

const BYOK_STORAGE_PREFIX = 'open-design:llm-api-key';
const MODEL_STORAGE_KEY = 'open-design.model';
const PROVIDER_STORAGE_KEY = 'open-design.provider';
const DEFAULT_TEST_KEY = 'sk-or-v1-test-mock-key-for-e2e';
const DEFAULT_TEST_MODEL = 'anthropic/claude-sonnet-4-5';
const DEFAULT_TEST_PROVIDER = 'openrouter';

export interface InjectByokOptions {
  /** Pretend OpenRouter key. Never sent to a real OpenRouter — interceptor catches it. */
  apiKey?: string;
  /** Model id (must be one of contracts/MODELS). Defaults to claude-sonnet-4-5. */
  model?: string;
  /** Provider id (one of contracts/PROVIDERS). Defaults to openrouter. */
  provider?: string;
}

/**
 * Inject BYOK key + model into localStorage before any app code runs.
 * Must be called per-page before page.goto('/').
 */
export async function injectByok(page: Page, options: InjectByokOptions = {}): Promise<void> {
  const apiKey = options.apiKey ?? DEFAULT_TEST_KEY;
  const model = options.model ?? DEFAULT_TEST_MODEL;
  const provider = options.provider ?? DEFAULT_TEST_PROVIDER;
  await page.addInitScript(
    ({ keyPrefix, keyValue, modelName, modelValue, providerName, providerValue }) => {
      // page.addInitScript runs in EVERY frame, including srcdoc preview
      // iframes whose sandbox may not include allow-same-origin (esp. plain
      // HTML projects). Skip non-top frames to avoid SecurityError on
      // localStorage access.
      if (window.top !== window) return;
      // Write the per-provider slot directly so the app's `byokKey.isSet`
      // returns true before the legacy-migration path has a chance to run.
      window.localStorage.setItem(`${keyPrefix}:${providerValue}`, keyValue);
      window.localStorage.setItem(modelName, modelValue);
      window.localStorage.setItem(providerName, providerValue);
    },
    {
      keyPrefix: BYOK_STORAGE_PREFIX,
      keyValue: apiKey,
      modelName: MODEL_STORAGE_KEY,
      modelValue: model,
      providerName: PROVIDER_STORAGE_KEY,
      providerValue: provider,
    },
  );
}
