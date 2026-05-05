// BYOK key injection for tests.
//
// 真实 storage 形状来自 apps/web/src/lib/byok-key.ts —— 一个简单 string，
// 不是 JSON 对象。
//
// model preference 单独存在 'open-design.model'（apps/web/src/lib/model-pref.ts），
// 测试里也写一个固定值，避免不同 dev 环境下默认 model 飘忽影响 mock 路由匹配。

import type { Page } from '@playwright/test';

const BYOK_STORAGE_KEY = 'open-design:llm-api-key';
const MODEL_STORAGE_KEY = 'open-design.model';
const DEFAULT_TEST_KEY = 'sk-or-v1-test-mock-key-for-e2e';
const DEFAULT_TEST_MODEL = 'anthropic/claude-sonnet-4-5';

export interface InjectByokOptions {
  /** Pretend OpenRouter key. Never sent to a real OpenRouter — interceptor catches it. */
  apiKey?: string;
  /** Model id (must be one of contracts/MODELS). Defaults to claude-sonnet-4-5. */
  model?: string;
}

/**
 * Inject BYOK key + model into localStorage before any app code runs.
 * Must be called per-page before page.goto('/').
 */
export async function injectByok(page: Page, options: InjectByokOptions = {}): Promise<void> {
  const apiKey = options.apiKey ?? DEFAULT_TEST_KEY;
  const model = options.model ?? DEFAULT_TEST_MODEL;
  await page.addInitScript(
    ({ keyName, keyValue, modelName, modelValue }) => {
      // page.addInitScript runs in EVERY frame, including srcdoc preview
      // iframes whose sandbox may not include allow-same-origin (esp. plain
      // HTML projects). Skip non-top frames to avoid SecurityError on
      // localStorage access.
      if (window.top !== window) return;
      window.localStorage.setItem(keyName, keyValue);
      window.localStorage.setItem(modelName, modelValue);
    },
    {
      keyName: BYOK_STORAGE_KEY,
      keyValue: apiKey,
      modelName: MODEL_STORAGE_KEY,
      modelValue: model,
    },
  );
}
