// 4 工具浮窗 e2e spec — Tweaks / Comment / Edit / Draw 深度覆盖
//
// 每条 case 至少 3 个独立断言，关键 case 5+。
//
// **协议字面量保持原样**：EDITMODE-BEGIN/END / SET_MODE / EDIT_STYLE /
// ELEMENT_SELECTED / postMessage 等。任何对这些字符串的"清理"都是协议破坏。
//
// helper 沿用 main-flow.spec.ts 的模式（injectByok + mockOpenRouter）；
// 这里需要更复杂的 artifact —— 带 EDITMODE 块 + 多个可点击元素。
//
// SUSPECTED BUG 标记：当行为与生产期待不符时，标 `// SUSPECTED BUG: ...`
// 并保留 failing assertion，让主线 agent 看到 root cause。

import { test, expect, type Page } from '../fixtures/test-with-tracker';
import { automatedToolsOverlayCases } from '../cases/tools-overlay';
import { injectByok } from '../fixtures/byok';
import { mockOpenRouter } from '../fixtures/openrouter-mock';

// EDITMODE-aware artifact —— 用 EDITMODE-BEGIN/END 块 + Tweaks 协议。
// `__edit_mode_available` 是子 message，由 artifact 主动 postMessage。
//
// 关键约束（CLAUDE.md §2 协议字面量）：
//   - /*EDITMODE-BEGIN*/ + /*EDITMODE-END*/ 字面量保持
//   - __edit_mode_available / __edit_mode_set_keys 不能改
//
// 设计：bg color + heading text 都映射成 EDITMODE 块的 keys，host PreviewPanel
// 可以通过 __edit_mode_set_keys postMessage 触发 PUT 持久化。
const TWEAKS_AWARE_APP_JSX = `const TOKENS = /*EDITMODE-BEGIN*/{
  "bgColor": "#ffffff",
  "heading": "Hello World"
}/*EDITMODE-END*/;

function App() {
  React.useEffect(() => {
    // 通知 host 这个 artifact 暴露 Tweaks
    try {
      window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    } catch (_) {}
  }, []);

  return React.createElement(
    'div',
    {
      'data-testid': 'app-root',
      style: { padding: '24px', background: TOKENS.bgColor, minHeight: '100vh' },
    },
    React.createElement(
      'h1',
      { 'data-testid': 'app-heading', id: 'app-heading' },
      TOKENS.heading,
    ),
    React.createElement(
      'p',
      { 'data-testid': 'app-para', id: 'app-para' },
      'Click me to test Comment / Edit modes.',
    ),
    React.createElement(
      'button',
      {
        'data-testid': 'app-btn',
        id: 'app-btn',
        style: { padding: '8px 16px', marginTop: '12px' },
      },
      'Hover me',
    ),
  );
}
`;

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

async function setupProject(
  page: Page,
  options: { artifact?: string; finishWithDone?: boolean } = {},
): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, {
    artifactFiles: [
      { path: 'App.jsx', content: options.artifact ?? TWEAKS_AWARE_APP_JSX, asset: 'App' },
    ],
    finishWithDone: options.finishWithDone !== false,
  });
}

async function createAndPromptProject(page: Page, projectName: string): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Project name').fill(projectName);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 10_000 });

  // 触发 mock 写 App.jsx
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.fill('Make me an app');
  await page.getByRole('button', { name: /^send$/i }).click();

  // 等 mock 全部回完（"All done." 或 assistant 文本可见）
  await expect(page.getByText('All done.', { exact: true })).toBeVisible({ timeout: 20_000 });

  // 切到 Preview tab 看 iframe（参考 main-flow.spec.ts）
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.locator('iframe[title="Preview"]')).toBeVisible({ timeout: 15_000 });
  // iframe 完全加载好（含 React mount + overlay 注入）
  const previewFrame = page.frameLocator('iframe[title="Preview"]');
  await expect(previewFrame.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });
}

async function projectIdFromUrl(page: Page): Promise<string> {
  const url = page.url();
  const m = url.match(/\/p\/([^/?#]+)/);
  if (!m) throw new Error(`Cannot extract projectId from URL: ${url}`);
  return decodeURIComponent(m[1]!);
}

async function readFile(page: Page, projectId: string, path: string): Promise<string> {
  const res = await page.request.get(
    `http://localhost:8787/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(path)}`,
  );
  if (!res.ok()) throw new Error(`GET file failed: ${res.status()}`);
  return await res.text();
}

async function listComments(page: Page, projectId: string): Promise<unknown[]> {
  const res = await page.request.get(
    `http://localhost:8787/api/projects/${encodeURIComponent(projectId)}/comments`,
  );
  if (!res.ok()) return [];
  const data = (await res.json()) as { comments?: unknown[] };
  return data.comments ?? [];
}

/** Capture iframe `iframe[title="Preview"]` element bounding box on the page. */
async function previewIframeBox(
  page: Page,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const handle = await page.locator('iframe[title="Preview"]').elementHandle();
  if (!handle) throw new Error('preview iframe not found');
  const box = await handle.boundingBox();
  if (!box) throw new Error('preview iframe has no bounding box');
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

// ─────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────

test.describe('tools overlay (Tweaks / Comment / Edit / Draw)', () => {
  // Serial: every case in this describe creates a fresh project + writes
  // App.jsx through the agent loop + boots the preview iframe (overlay,
  // React mount, srcdoc build, comment / draw / tweaks handlers). Running
  // them concurrently against a single wrangler dev server saturates the
  // file API + iframe initial-paint deadline (30s) trips. Cost of serial
  // mode is ~5-10s per case (~1.5 min total) → acceptable.
  test.describe.configure({ mode: 'serial' });
  for (const c of automatedToolsOverlayCases()) {
    test(c.id, async ({ page, errorTracker }) => {
      // catch console errors —— iframe-not-ready case 用得上
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      switch (c.id) {
        case 'tweaks-enter-mode':
          await runTweaksEnterMode(page);
          break;
        case 'tweaks-artifact-roundtrip':
          await runTweaksArtifactRoundtrip(page);
          break;
        case 'comment-hover-shows-outline':
          await runCommentHoverShowsOutline(page);
          break;
        case 'comment-pin-create-and-persist':
          await runCommentPinCreateAndPersist(page);
          break;
        case 'edit-select-shows-float':
          await runEditSelectShowsFloat(page);
          break;
        case 'edit-style-change-emits-postmessage':
          await runEditStyleChangeEmitsPostMessage(page);
          break;
        case 'draw-dock-visible':
          await runDrawDockVisible(page);
          break;
        case 'draw-stroke-on-canvas':
          await runDrawStrokeOnCanvas(page);
          break;
        case 'tool-switch-mutual-exclusion':
          await runToolSwitchMutualExclusion(page);
          break;
        case 'tool-toggle-off':
          await runToolToggleOff(page);
          break;
        case 'tool-button-keyboard-a11y':
          await runToolButtonKeyboardA11y(page);
          break;
        case 'iframe-not-ready-tool-click':
          await runIframeNotReadyToolClick(page, consoleErrors);
          break;
        case 'tweaks-put-failure-shows-toast':
          await runTweaksPutFailureShowsToast(page, errorTracker);
          break;
        default:
          throw new Error(`No spec body for case ${c.id}`);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Test bodies
// ─────────────────────────────────────────────────────────────────────────

async function runTweaksEnterMode(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E tweaks ${Date.now()}`);

  const tweaksBtn = page.getByTestId('toolbar-tweaks');
  const commentBtn = page.getByTestId('toolbar-comment');

  // Initially inactive
  await expect(tweaksBtn).toHaveAttribute('data-active', 'false');
  await expect(tweaksBtn).toHaveAttribute('aria-pressed', 'false');

  // Click → active
  await tweaksBtn.click();
  await expect(tweaksBtn).toHaveAttribute('data-active', 'true');
  await expect(tweaksBtn).toHaveAttribute('aria-pressed', 'true');

  // 切到 Comment → Tweaks 退出
  await commentBtn.click();
  await expect(tweaksBtn).toHaveAttribute('data-active', 'false');
  await expect(commentBtn).toHaveAttribute('data-active', 'true');
}

async function runTweaksArtifactRoundtrip(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E tweaks rt ${Date.now()}`);

  const projectId = await projectIdFromUrl(page);

  // 验初始 artifact 包含 EDITMODE 协议字面量
  const initial = await readFile(page, projectId, 'App.jsx');
  expect(initial).toContain('/*EDITMODE-BEGIN*/');
  expect(initial).toContain('/*EDITMODE-END*/');
  expect(initial).toContain('"bgColor"');

  // 进 Tweaks 模式
  await page.getByTestId('toolbar-tweaks').click();
  await expect(page.getByTestId('toolbar-tweaks')).toHaveAttribute('data-active', 'true');

  // 模拟 artifact 主动发 __edit_mode_set_keys（host 收到会 PUT）
  // 直接 evaluate 在 iframe 内 dispatch postMessage
  const previewFrameElem = await page.locator('iframe[title="Preview"]').elementHandle();
  expect(previewFrameElem).not.toBeNull();
  const frame = await previewFrameElem!.contentFrame();
  expect(frame).not.toBeNull();
  await frame!.evaluate(() => {
    window.parent.postMessage(
      {
        type: '__edit_mode_set_keys',
        edits: { bgColor: '#FF00FF' },
      },
      '*',
    );
  });

  // 等 host 把 PUT 写回 file（轮询）
  await expect
    .poll(
      async () => {
        const content = await readFile(page, projectId, 'App.jsx');
        return content.includes('"bgColor"') && content.includes('#FF00FF');
      },
      { timeout: 10_000, intervals: [200, 500, 1000] },
    )
    .toBe(true);

  // 验持久化后协议字面量仍在
  const after = await readFile(page, projectId, 'App.jsx');
  expect(after).toContain('/*EDITMODE-BEGIN*/');
  expect(after).toContain('/*EDITMODE-END*/');
  expect(after).toContain('#FF00FF');
}

async function runCommentHoverShowsOutline(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E comment hover ${Date.now()}`);

  // 进 Comment mode
  await page.getByTestId('toolbar-comment').click();
  await expect(page.getByTestId('toolbar-comment')).toHaveAttribute('data-active', 'true');

  const previewFrameElem = await page.locator('iframe[title="Preview"]').elementHandle();
  const frame = await previewFrameElem!.contentFrame();
  expect(frame).not.toBeNull();

  // 等 SET_MODE comment 传到 iframe，document.body cursor 应变 crosshair
  await expect
    .poll(
      async () => {
        return await frame!.evaluate(() => document.body.style.cursor);
      },
      { timeout: 5000 },
    )
    .toBe('crosshair');

  // hover 一个元素 → outline 应被设
  const heading = frame!.getByTestId('app-heading');
  await heading.hover();

  // overlay.ts: HOVER_OUTLINE = '2px solid #c96442'，挂在 element.style.outline
  // 浏览器可能把 hex 转 rgb(201, 100, 66) — 接受任一
  await expect
    .poll(
      async () => {
        return await frame!.evaluate(() => {
          const el = document.querySelector<HTMLElement>('[data-testid="app-heading"]');
          return el?.style.outline ?? '';
        });
      },
      { timeout: 5000 },
    )
    .toMatch(/(c96442|rgb\(201,\s*100,\s*66\))/i);
}

async function runCommentPinCreateAndPersist(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E comment pin ${Date.now()}`);
  const projectId = await projectIdFromUrl(page);

  // 进 Comment mode
  await page.getByTestId('toolbar-comment').click();
  await expect(page.getByTestId('toolbar-comment')).toHaveAttribute('data-active', 'true');

  // click on iframe heading → ELEMENT_SELECTED → draft pin
  const previewFrameElem = await page.locator('iframe[title="Preview"]').elementHandle();
  const frame = await previewFrameElem!.contentFrame();
  expect(frame).not.toBeNull();
  await frame!.getByTestId('app-heading').click();

  // draft pin 出现
  const draft = page.getByTestId('comment-pin-draft');
  await expect(draft).toBeVisible({ timeout: 5_000 });

  // textarea 自动 focus + 输入文字
  const textarea = page.getByTestId('comment-pin-textarea');
  await expect(textarea).toBeFocused();
  await textarea.fill('This heading needs polishing.');

  // 用网络请求等监听 POST /comments
  const postPromise = page.waitForRequest(
    (req) => req.method() === 'POST' && /\/api\/projects\/.+\/comments$/.test(req.url()),
    { timeout: 10_000 },
  );

  // Save pin
  await page.getByTestId('comment-pin-save').click();

  const postReq = await postPromise;
  expect(postReq.method()).toBe('POST');

  // confirmed pin 显示
  await expect(page.getByTestId('comment-pin').first()).toBeVisible({ timeout: 5_000 });
  await expect(draft).not.toBeVisible();

  // reload page → pin 仍在（持久化检查）
  await page.reload();
  // 重新走 BYOK + mock —— reload 后 page-level state 重置
  // 注意：reload 不会触发新的 chat，App.jsx 已经在 D1 / R2 落盘了
  await expect(page.locator('iframe[title="Preview"]')).toBeVisible({ timeout: 15_000 });
  const reframeElem = await page.locator('iframe[title="Preview"]').elementHandle();
  const reframe = await reframeElem!.contentFrame();
  await expect(reframe!.getByTestId('app-root')).toBeVisible({ timeout: 30_000 });
  // PreviewPanel 设计：非 Comment 模式时只显示当前选中的 pin（state.selectedPinId）；
  // reload 后 selectedPinId 是 null → pin 被过滤掉。要 assert 持久化的 pin
  // 仍存在，先切回 Comment 模式让所有 pin 显示。
  await page.getByTestId('toolbar-comment').click();
  await expect(page.getByTestId('toolbar-comment')).toHaveAttribute('data-active', 'true');
  // pin 应回归（comments 从 D1 拉回 + Comment 模式渲染所有）
  await expect(page.getByTestId('comment-pin').first()).toBeVisible({ timeout: 10_000 });

  // 验后端 comments API 也能拿到
  const comments = await listComments(page, projectId);
  expect(comments.length).toBeGreaterThanOrEqual(1);
}

async function runEditSelectShowsFloat(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E edit float ${Date.now()}`);

  // 进 Edit mode
  await page.getByTestId('toolbar-edit').click();
  await expect(page.getByTestId('toolbar-edit')).toHaveAttribute('data-active', 'true');

  // EditFloat 出现 — 但此时还没 selection
  const editFloat = page.getByTestId('edit-float');
  await expect(editFloat).toBeVisible({ timeout: 5_000 });
  await expect(editFloat).toHaveAttribute('data-has-selection', 'false');

  // click on iframe button
  const previewFrameElem = await page.locator('iframe[title="Preview"]').elementHandle();
  const frame = await previewFrameElem!.contentFrame();
  expect(frame).not.toBeNull();
  await frame!.getByTestId('app-btn').click();

  // selection 状态切换 + tag 显示 'button'
  await expect(editFloat).toHaveAttribute('data-has-selection', 'true', { timeout: 5_000 });
  const tag = page.getByTestId('edit-float-selection-tag');
  await expect(tag).toHaveText('button');

  // pinned outline 应被设（PINNED_OUTLINE = '2.5px solid #b5441a'）
  // 浏览器会把 hex 转成 rgb(181, 68, 26)；接受任一形式
  await expect
    .poll(
      async () => {
        return await frame!.evaluate(() => {
          const el = document.querySelector<HTMLElement>('[data-testid="app-btn"]');
          return el?.style.outline ?? '';
        });
      },
      { timeout: 3000 },
    )
    .toMatch(/(b5441a|rgb\(181,\s*68,\s*26\))/i);
}

async function runEditStyleChangeEmitsPostMessage(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E edit style ${Date.now()}`);
  const projectId = await projectIdFromUrl(page);

  // 进 Edit mode + select button
  await page.getByTestId('toolbar-edit').click();
  await expect(page.getByTestId('toolbar-edit')).toHaveAttribute('data-active', 'true');

  const previewFrameElem = await page.locator('iframe[title="Preview"]').elementHandle();
  const frame = await previewFrameElem!.contentFrame();
  await frame!.getByTestId('app-btn').click();
  await expect(page.getByTestId('edit-float')).toHaveAttribute('data-has-selection', 'true');

  // 在 iframe 里挂 message listener 捕获 EDIT_STYLE
  await frame!.evaluate(() => {
    (window as unknown as { __editStyles: unknown[] }).__editStyles = [];
    window.addEventListener('message', (e) => {
      const data = (e as MessageEvent).data;
      if (data && data.type === 'EDIT_STYLE') {
        (window as unknown as { __editStyles: unknown[] }).__editStyles.push(data);
      }
    });
  });

  // 改 background swatch → 应触发 EDIT_STYLE postMessage 进 iframe
  await page.getByTestId('edit-float-bg-#141413').click();

  // 等 EDIT_STYLE 进 iframe
  await expect
    .poll(
      async () => {
        return await frame!.evaluate(
          () => (window as unknown as { __editStyles: unknown[] }).__editStyles.length,
        );
      },
      { timeout: 3000 },
    )
    .toBeGreaterThanOrEqual(1);

  // 切走 Edit → 触发 persistence。
  // P2-12 修复后：persist-edit-utils.ts 用 AST 而不是 outerHTML grep，能命中
  // React.createElement 的 button — App.jsx 应该被改写带上新 background。
  await page.getByTestId('toolbar-edit').click();
  await expect(page.getByTestId('toolbar-edit')).toHaveAttribute('data-active', 'false');

  // 给 host 一点时间触发 PUT
  await page.waitForTimeout(800);

  // 文件未被破坏（仍能读 + 仍是合法 jsx）
  const after = await readFile(page, projectId, 'App.jsx');
  expect(after.length).toBeGreaterThan(0);
  expect(after).toContain('function App');
  // P2-12: 期望 createElement 的 button props 里出现新 background color #141413。
  // 不强求确切格式（AST splice 后可能形状略不同），只 best-effort 看到颜色值。
  // 如果未来此处 fail，回到 unit test 看具体 splice 输出再调整断言。
  expect(after).toMatch(/#141413|background[^,}]*141413/i);
}

async function runDrawDockVisible(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E draw dock ${Date.now()}`);

  // 进 Draw mode
  await page.getByTestId('toolbar-draw').click();
  await expect(page.getByTestId('toolbar-draw')).toHaveAttribute('data-active', 'true');

  // DrawDock 容器出现
  const dock = page.getByTestId('draw-dock');
  await expect(dock).toBeVisible({ timeout: 5_000 });

  // 三个 submode 按钮在
  await expect(page.getByTestId('draw-submode-draw')).toBeVisible();
  await expect(page.getByTestId('draw-submode-click')).toBeVisible();
  await expect(page.getByTestId('draw-submode-voice')).toBeVisible();

  // Voice disabled
  await expect(page.getByTestId('draw-submode-voice')).toBeDisabled();

  // 默认 Draw submode active
  await expect(page.getByTestId('draw-submode-draw')).toHaveAttribute('data-active', 'true');

  // Send 因为 0 strokes 是 disabled
  await expect(page.getByTestId('draw-send')).toBeDisabled();

  // 切到 click → active 切换
  await page.getByTestId('draw-submode-click').click();
  await expect(page.getByTestId('draw-submode-click')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('draw-submode-draw')).toHaveAttribute('data-active', 'false');
}

async function runDrawStrokeOnCanvas(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E draw stroke ${Date.now()}`);

  // 进 Draw mode
  await page.getByTestId('toolbar-draw').click();
  await expect(page.getByTestId('draw-overlay-canvas')).toBeVisible();
  await expect(page.getByTestId('draw-overlay-canvas')).toHaveAttribute('data-active', 'true');

  // 初始 0 strokes
  await expect(page.getByTestId('draw-stroke-count')).toHaveText('0 marks');

  // 模拟 pointer down → move → up（在 iframe box 内）
  const box = await previewIframeBox(page);
  const startX = box.x + box.w * 0.3;
  const startY = box.y + box.h * 0.4;
  const endX = box.x + box.w * 0.6;
  const endY = box.y + box.h * 0.6;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY + 10, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 6 });
  await page.mouse.up();

  // SVG polyline 应至少 1 个
  await expect(page.getByTestId('draw-shape-stroke').first()).toBeVisible({ timeout: 3_000 });

  // counter 变 1
  await expect(page.getByTestId('draw-stroke-count')).toHaveText('1 marks', { timeout: 3_000 });

  // Send 不再 disabled
  await expect(page.getByTestId('draw-send')).toBeEnabled();
}

async function runToolSwitchMutualExclusion(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E tool mutex ${Date.now()}`);

  const tools = ['tweaks', 'comment', 'edit', 'draw'] as const;
  // 跑完整 4 工具循环切换：每次只有一个 active
  for (let i = 0; i < tools.length; i++) {
    const cur = tools[i]!;
    await page.getByTestId(`toolbar-${cur}`).click();
    // 等 React 状态推到 DOM
    await expect(page.getByTestId(`toolbar-${cur}`)).toHaveAttribute('data-active', 'true');
    // 其它 3 个 inactive
    for (const other of tools) {
      if (other === cur) continue;
      await expect(page.getByTestId(`toolbar-${other}`)).toHaveAttribute('data-active', 'false');
    }
  }
}

async function runToolToggleOff(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E tool toggle ${Date.now()}`);

  const drawBtn = page.getByTestId('toolbar-draw');

  await drawBtn.click();
  await expect(drawBtn).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('draw-dock')).toBeVisible();

  // 第二次点 → 关闭
  await drawBtn.click();
  await expect(drawBtn).toHaveAttribute('data-active', 'false');
  await expect(page.getByTestId('draw-dock')).not.toBeVisible({ timeout: 3_000 });
}

async function runToolButtonKeyboardA11y(page: Page): Promise<void> {
  await setupProject(page);
  await createAndPromptProject(page, `E2E a11y ${Date.now()}`);

  const tweaksBtn = page.getByTestId('toolbar-tweaks');
  // focus + 用 Enter 触发
  await tweaksBtn.focus();
  await expect(tweaksBtn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tweaksBtn).toHaveAttribute('data-active', 'true');
  await expect(tweaksBtn).toHaveAttribute('aria-pressed', 'true');
  // aria-label 存在
  await expect(tweaksBtn).toHaveAttribute('aria-label', /tool/i);

  // Tab 到下一个工具按钮（comment）
  await page.keyboard.press('Tab');
  // 不要硬断言 focus 在 comment（中间可能有其它可 focus 元素），但至少不应在 tweaks 上
  await expect(tweaksBtn).not.toBeFocused();
}

// ─────────────────────────────────────────────────────────────────────────
// P1-8 fix: Tweaks PUT failure must surface a toast.
// ─────────────────────────────────────────────────────────────────────────

async function runTweaksPutFailureShowsToast(
  page: Page,
  errorTracker: import('../fixtures/error-tracker').ErrorTracker,
): Promise<void> {
  // 故意触发 PUT 500 → ack 让 tracker 不报
  errorTracker.acknowledge({
    network: [{ urlPattern: /\/api\/projects\/.+\/files\//, status: 500, method: 'PUT' }],
    console: [
      { consoleTextPattern: /Failed to load resource.*500/i },
      { consoleTextPattern: /failed to persist Tweaks change/i },
    ],
  });

  await setupProject(page);
  await createAndPromptProject(page, `E2E tweaks put-fail ${Date.now()}`);

  // Intercept PUT /api/projects/:id/files/* → 500. Only the PUT — let GETs
  // through so the project loads normally.
  await page.route('**/api/projects/*/files/**', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'internal_error',
          message: 'mock PUT files endpoint failed',
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Enter Tweaks mode
  await page.getByTestId('toolbar-tweaks').click();
  await expect(page.getByTestId('toolbar-tweaks')).toHaveAttribute('data-active', 'true');

  // Drive an artifact-side __edit_mode_set_keys postMessage (mirrors
  // tweaks-artifact-roundtrip). The host PUT will get the 500.
  const previewFrameElem = await page.locator('iframe[title="Preview"]').elementHandle();
  expect(previewFrameElem).not.toBeNull();
  const frame = await previewFrameElem!.contentFrame();
  expect(frame).not.toBeNull();
  await frame!.evaluate(() => {
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { bgColor: '#FF00FF' } }, '*');
  });

  // Assertion 1: toast appears with role=alert
  const toast = page.getByTestId('toast');
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast).toHaveAttribute('role', 'alert');

  // Assertion 2: toast message conveys the failure (not just generic "error")
  await expect(toast).toContainText(/save|tweak|unsaved/i);

  // Assertion 3: only ONE toast instance (stable id collapses repeats)
  expect(await page.getByTestId('toast').count()).toBe(1);
}

async function runIframeNotReadyToolClick(page: Page, consoleErrors: string[]): Promise<void> {
  await injectByok(page);
  // **不 mock OpenRouter** —— 没文件落盘 → iframe srcdoc='' → placeholder
  // 但仍要拦 OpenRouter 防意外打到真实端点
  await mockOpenRouter(page, { artifactFiles: [], finishWithDone: false });

  await page.goto('/');
  await page.getByPlaceholder('Project name').fill(`E2E race ${Date.now()}`);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 10_000 });

  // 切到 Preview tab —— 还没文件，应显示 placeholder
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByText(/Start chatting to generate your first preview/i)).toBeVisible({
    timeout: 10_000,
  });

  // 此时点工具按钮 —— iframe 还没 srcdoc，但点应该不抛
  await page.getByTestId('toolbar-tweaks').click();
  await expect(page.getByTestId('toolbar-tweaks')).toHaveAttribute('data-active', 'true');
  // P2-13: empty-iframe → 显示 generate-first hint 而不是 EditFloat / DrawDock
  await expect(page.getByTestId('preview-empty-tool-hint')).toBeVisible({ timeout: 3_000 });

  await page.getByTestId('toolbar-comment').click();
  await expect(page.getByTestId('toolbar-comment')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('preview-empty-tool-hint')).toBeVisible();

  await page.getByTestId('toolbar-edit').click();
  await expect(page.getByTestId('toolbar-edit')).toHaveAttribute('data-active', 'true');
  // P2-13: EditFloat 不应渲染（iframe 没 srcdoc → 没元素可 inspect）
  await expect(page.getByTestId('edit-float')).toHaveCount(0);
  await expect(page.getByTestId('preview-empty-tool-hint')).toBeVisible();

  await page.getByTestId('toolbar-draw').click();
  await expect(page.getByTestId('toolbar-draw')).toHaveAttribute('data-active', 'true');
  // P2-13: DrawDock 不应渲染（没画布 backdrop 可绘）
  await expect(page.getByTestId('draw-dock')).toHaveCount(0);
  await expect(page.getByTestId('preview-empty-tool-hint')).toBeVisible();

  // 不应有 console error（race 不应抛）
  const real = consoleErrors.filter(
    (e) =>
      !/favicon|net::ERR_FAILED|404 .* favicon|chrome-extension/i.test(e) &&
      // openrouter mock 有时会触发 SDK 报 missing key 之类，过滤
      !/openrouter/i.test(e),
  );
  expect(real, `unexpected console errors: ${real.join('\n')}`).toHaveLength(0);
}
