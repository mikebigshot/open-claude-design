// Playwright fixture：在 base test 上扩展 errorTracker。
//
// 每个 spec import { test, expect } from '../fixtures/test-with-tracker'
// 替代 '@playwright/test'，afterEach 自动 assert 没有未预期的 console / page /
// network 错误。
//
// 故意触发错误的 case 用 errorTracker.acknowledge({...}) 显式标记预期。

import {
  test as base,
  expect,
  type Page,
  type Locator,
  type Route,
  type Request,
} from '@playwright/test';
import { attachErrorTrackers, type ErrorTracker } from './error-tracker';

// auto: true 让 fixture 对每个 case 自动激活，case 不必显式 destructure
// errorTracker — 这样所有现有 spec 不用改 case body 就能享受 tracker。
export const test = base.extend<{ errorTracker: ErrorTracker }>({
  errorTracker: [
    async ({ page }, use, testInfo) => {
      const tracker = attachErrorTrackers(page);
      await use(tracker);

      // afterEach: 检查 unexpected errors
      // 测试本身已 fail 的场合不再 assert（避免 cascade noise）
      if (testInfo.status === 'failed' || testInfo.status === 'timedOut') {
        return;
      }

      const unexpected = tracker.getUnexpected();
      const messages: string[] = [];
      if (unexpected.console.length > 0) {
        messages.push(`Console errors (${unexpected.console.length}):`);
        unexpected.console.forEach((e) => messages.push(`  - ${e}`));
      }
      if (unexpected.page.length > 0) {
        messages.push(`Page errors (${unexpected.page.length}):`);
        unexpected.page.forEach((e) => messages.push(`  - ${e}`));
      }
      if (unexpected.network.length > 0) {
        messages.push(`Network 4xx/5xx (${unexpected.network.length}):`);
        unexpected.network.forEach((e) => messages.push(`  - ${e.method} ${e.url} → ${e.status}`));
      }
      if (messages.length > 0) {
        throw new Error(
          `[error-tracker] Unexpected errors during test:\n${messages.join('\n')}\n` +
            `Use errorTracker.acknowledge({...}) to mark expected errors.`,
        );
      }
    },
    { auto: true },
  ],
});

export { expect, type Page, type Locator, type Route, type Request };
