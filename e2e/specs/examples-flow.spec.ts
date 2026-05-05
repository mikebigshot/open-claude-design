// Examples gallery e2e — covers the 2026-05-04 bug fixes.
//
// 跑测试：
//   npm run test:e2e --workspace=@open-design/e2e -- specs/examples-flow.spec.ts
//
// 注意事项：
//   - 不需要 mockOpenRouter —— 我们只验"点 Use this prompt → 跳转 → 预填"
//     这条路径，不发送 chat 消息（核心断言：必须不自动发！）。
//   - hover 测试用 page.hover()，不用 fireEvent 因为 e2e 是真浏览器
//   - 用 getComputedStyle 验 iframe pointer-events / box height（DOM 层观察）

import { test, expect, type Page } from '../fixtures/test-with-tracker';
import { automatedExamplesFlowCases } from '../cases/examples-flow';
import { injectByok } from '../fixtures/byok';

// ───── helpers ─────

const EXAMPLE_SLUGS = ['counter', 'todo', 'landing-page', 'dashboard'] as const;

async function gotoHomeExamplesTab(page: Page) {
  await page.goto('/');
  // Home 页有 tabs；点 "Examples" tab。pattern 跟设计一致：tab list role
  await page.getByRole('tab', { name: /examples/i }).click();
  // 等第一张卡 visible
  await expect(page.getByTestId(`example-preview-${EXAMPLE_SLUGS[0]}`)).toBeVisible({
    timeout: 10_000,
  });
}

async function getDataActive(page: Page, slug: string): Promise<string | null> {
  return page.getByTestId(`example-preview-${slug}`).getAttribute('data-active');
}

async function getIframePointerEvents(page: Page, slug: string): Promise<string> {
  return page.getByTestId(`example-preview-${slug}`).evaluate((box: HTMLElement) => {
    const iframe = box.querySelector('iframe');
    if (!iframe) return 'no-iframe';
    return window.getComputedStyle(iframe).pointerEvents;
  });
}

async function getBoxHeight(page: Page, slug: string): Promise<number> {
  return page.getByTestId(`example-preview-${slug}`).evaluate((box: HTMLElement) => {
    return Math.round(box.getBoundingClientRect().height);
  });
}

// ───── spec body ─────

test.describe('examples flow', () => {
  for (const c of automatedExamplesFlowCases()) {
    test(c.id, async ({ page, errorTracker }) => {
      switch (c.id) {
        case 'examples-tab-renders-all-cards':
          await runRendersAllCards(page);
          break;
        case 'examples-use-prompt-prefills-composer-with-key':
          await runPrefillsComposerWithKey(page);
          break;
        case 'examples-use-prompt-prefills-composer-without-key':
          await runPrefillsComposerWithoutKey(page);
          break;
        case 'examples-hover-activates-preview':
          await runHoverActivatesPreview(page);
          break;
        case 'examples-mutual-exclusion-on-hover':
          await runMutualExclusion(page);
          break;
        default:
          throw new Error(`No spec body for case ${c.id}`);
      }
      // 所有 case 共享：页面没有 console.error 或 page error
      void errorTracker;
    });
  }
});

async function runRendersAllCards(page: Page) {
  await injectByok(page);
  await gotoHomeExamplesTab(page);
  for (const slug of EXAMPLE_SLUGS) {
    await expect(page.getByTestId(`example-preview-${slug}`)).toBeVisible();
  }
  // Intro 文案确认 draft 模式：必须含"pre-filled"，必须不含"auto-send"
  const intro = await page.getByText(/spin up a new project with the prompt/i).textContent();
  expect(intro).toBeTruthy();
  expect(intro!.toLowerCase()).toContain('pre-filled');
  expect(intro!.toLowerCase()).not.toContain('auto-send');
  // 每张卡上的 hint 默认可见
  expect(await page.getByText(/HOVER TO INTERACT/).count()).toBeGreaterThanOrEqual(
    EXAMPLE_SLUGS.length,
  );
}

async function runPrefillsComposerWithKey(page: Page) {
  await injectByok(page);
  await gotoHomeExamplesTab(page);

  // 点第一张卡的 "Use this prompt"
  const card = page
    .getByTestId(`example-preview-${EXAMPLE_SLUGS[0]}`)
    .locator('xpath=ancestor::article');
  await card.getByRole('button', { name: /use this prompt/i }).click();

  // 跳到 /p/:id
  await page.waitForURL(/\/p\/[^/]+/, { timeout: 15_000 });

  // Composer textarea 出现 —— 用 toHaveValue 自动 retry，避免 visible-but-empty race
  // (Workspace mount drain → setComposerSeed → ChatPanel effect → setInput 链路有几
  // 个 dispatch 跳跃，textarea 先 visible 再 value 进来)
  const textarea = page.getByRole('textbox', { name: /chat composer/i });
  await expect(textarea).toBeVisible({ timeout: 15_000 });
  await expect(textarea).toHaveValue(/counter/i, { timeout: 10_000 });

  // CRITICAL: 不自动发送 —— chat history 不应该有 user message
  await expect(page.locator('[data-testid^="chat-msg-user-"]')).toHaveCount(0);
}

async function runPrefillsComposerWithoutKey(page: Page) {
  // 不注入 BYOK key —— 用 addInitScript 在每个新文档加载前清掉
  // localStorage，避免跟前一个 worker 的 navigate / Vite warm-up race。
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('open-design:llm-api-key');
    } catch {
      /* fine, just don't crash */
    }
  });
  await page.goto('/');

  await page.getByRole('tab', { name: /examples/i }).click();
  await expect(page.getByTestId(`example-preview-${EXAMPLE_SLUGS[0]}`)).toBeVisible({
    timeout: 10_000,
  });

  const card = page
    .getByTestId(`example-preview-${EXAMPLE_SLUGS[0]}`)
    .locator('xpath=ancestor::article');
  await card.getByRole('button', { name: /use this prompt/i }).click();

  await page.waitForURL(/\/p\/[^/]+/, { timeout: 15_000 });

  const textarea = page.getByRole('textbox', { name: /chat composer/i });
  await expect(textarea).toBeVisible({ timeout: 15_000 });
  // toHaveValue 自带 retry，等到 setComposerSeed → setInput 链路完成
  await expect(textarea).not.toHaveValue('', { timeout: 10_000 });

  // Bug 1 核心 regression guard: 没自动发送 → 不弹 KeyModal
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // user message 也不存在（确认没有偷偷发送）
  await expect(page.locator('[data-testid^="chat-msg-user-"]')).toHaveCount(0);
}

async function runHoverActivatesPreview(page: Page) {
  await injectByok(page);
  await gotoHomeExamplesTab(page);

  const slug = EXAMPLE_SLUGS[0]!;
  // 默认 inactive：iframe pointer-events: none (hover 进 iframe 不会触发 wheel)
  expect(await getDataActive(page, slug)).toBe('false');
  expect(await getIframePointerEvents(page, slug)).toBe('none');
  // 高度固定 480px (v2: 不再因 hover 撑大，对齐官方 gallery 稳态布局)
  const heightBefore = await getBoxHeight(page, slug);
  expect(heightBefore).toBeGreaterThanOrEqual(470);
  expect(heightBefore).toBeLessThanOrEqual(490);

  await page.getByTestId(`example-preview-${slug}`).hover();
  // 短延时让 React 处理 onMouseEnter
  await page.waitForTimeout(80);

  // hover 后：data-active=true、iframe pointer-events=auto；高度仍 480px
  expect(await getDataActive(page, slug)).toBe('true');
  expect(await getIframePointerEvents(page, slug)).toBe('auto');
  const heightAfter = await getBoxHeight(page, slug);
  expect(heightAfter).toBe(heightBefore); // 不变化
}

async function runMutualExclusion(page: Page) {
  await injectByok(page);
  await gotoHomeExamplesTab(page);

  const slugA = EXAMPLE_SLUGS[0]!;
  const slugB = EXAMPLE_SLUGS[1]!;

  await page.getByTestId(`example-preview-${slugA}`).hover();
  await page.waitForTimeout(50);
  expect(await getDataActive(page, slugA)).toBe('true');
  expect(await getDataActive(page, slugB)).toBe('false');

  // hover B —— A 必须立即 inactive (cross-card move cancels A's leave debounce)
  await page.getByTestId(`example-preview-${slugB}`).hover();
  await page.waitForTimeout(50);
  expect(await getDataActive(page, slugA)).toBe('false');
  expect(await getDataActive(page, slugB)).toBe('true');
}
