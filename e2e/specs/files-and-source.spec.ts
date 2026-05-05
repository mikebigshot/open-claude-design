// Files-and-source e2e — 文件树 + 源码 / Preview tab 切换 + 入口选择 + 路径边界。
//
// 比 main-flow 更深，覆盖：
//   F-* 文件树点击 + tab 切换
//   E-* 入口文件选择优先级（pickEntry / pickHtmlEntry）
//   P-* 路径边界（嵌套 / 空格）
//   ER-* 错误路径
//   A11Y-* 键盘可达
//
// 跟 main-flow 协调：
//   - 同一份 mockOpenRouter / injectByok fixture
//   - 共用 dev server（webServer reuseExistingServer:true）
//   - 共用 testid 命名习惯（file-tree-item-{path} / tab-preview / etc）
//
// SUSPECTED BUG: F-2 当前会失败 —— 主线修了 ChatPanel.tsx
// auto-set-active-tab 的逻辑后会绿。详见 case 注释。

import { expect, test, type Page } from '../fixtures/test-with-tracker';

import { filesAndSourceCases } from '../cases/files-and-source';
import { injectByok } from '../fixtures/byok';
import { mockOpenRouter } from '../fixtures/openrouter-mock';

const APP_JSX_CONTENT = `export default function App() {
  return (
    <div>
      <h1 data-testid="mock-app-heading">Mock App</h1>
      <p data-testid="mock-app-version">v1.0</p>
    </div>
  );
}
`;

const INDEX_JSX_CONTENT = `export default function Index() {
  return <h1 data-testid="mock-index-heading">Index Page (should NOT render)</h1>;
}
`;

const NESTED_BUTTON_JSX = `export default function Button() {
  return <button data-testid="mock-nested-button">Click me</button>;
}
`;

const SPACE_PATH_JSX = `export default function Foo() {
  return <span data-testid="mock-space-path">Foo Bar</span>;
}
`;

const HTML_ONLY_CONTENT = `<!DOCTYPE html>
<html>
  <head><title>HTML Only</title></head>
  <body>
    <h1 data-testid="mock-html-only-heading">Plain HTML</h1>
  </body>
</html>
`;

// ──────────── helpers ────────────

async function createProject(page: Page, prefix: string): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Project name').fill(`${prefix} ${Date.now()}`);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 10_000 });
}

async function sendChatPrompt(page: Page, prompt: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.fill(prompt);
  await page.getByRole('button', { name: /^send$/i }).click();
  // mock fixture 最后一个 turn 是 'All done.' (finishWithDone:true)。等到这个文本
  // 出现说明 tool 链已经跑完了，文件已落盘。
  await expect(page.getByText('All done.', { exact: true })).toBeVisible({ timeout: 30_000 });
}

/**
 * 把 workspace 稳定到 Design Files tab。
 *
 * P0-1 + P0-3 fix (2026-05-03): ChatPanel 不再 dispatch path-类 active tab,
 * FileTree auto-pick 守门改为 state.autoPickDone(set_active_tab 即设),所以
 * 单击就稳。不再需要"踢两次"helper hack。
 */
async function gotoDesignFilesStable(page: Page): Promise<void> {
  await page.getByTestId('tab-design-files').click();
  await expect(page.getByTestId('tab-design-files')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('file-tree')).toBeVisible();
}

// ──────────── spec ────────────

test.describe('files-and-source', () => {
  test.beforeEach(async ({ page }) => {
    await injectByok(page);
  });

  // 在 cases 表里查找一条用于挂 notes 的元数据（仅做定位）
  function caseById(id: string) {
    const c = filesAndSourceCases.find((x) => x.id === id);
    if (!c) throw new Error(`case ${id} missing in files-and-source.ts`);
    return c;
  }

  // ───── F-1 ─────
  test(caseById('F-1-tree-shows-app-jsx').id, async ({ page }) => {
    await mockOpenRouter(page, {
      artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
      finishWithDone: true,
    });
    await createProject(page, 'F-1');
    await sendChatPrompt(page, 'Generate App.jsx');

    // 切回 Design Files tab —— ChatPanel auto-pick 后默认在 PREVIEW_TAB（或
    // jsx tab，依 P0 bug 而定）。我们要看的是 file tree 内容。
    await gotoDesignFilesStable(page);

    // tree root 容器 + App.jsx 行 + 行可点
    await expect(page.getByTestId('file-tree')).toBeVisible();
    const row = page.getByTestId('file-tree-item-App.jsx');
    await expect(row).toBeVisible();
    await expect(row).toContainText('App.jsx');

    // 点了之后 row 标记为 active + FilePreviewPane 标题切到 App.jsx
    await row.click();
    await expect(row).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('file-preview-pane')).toHaveAttribute(
      'data-file-path',
      'App.jsx',
    );
    await expect(page.getByTestId('file-preview-filename')).toHaveText('App.jsx');
  });

  // ───── F-2 (P0 fixed 2026-05-03) ─────
  test(caseById('F-2-default-renders-preview').id, async ({ page }) => {
    await mockOpenRouter(page, {
      artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
      finishWithDone: true,
    });
    await createProject(page, 'F-2');

    // 生成完 App.jsx 后，默认的 workspace 视图应该是 iframe Preview（运行起来
    // 的 React 应用），不是 FileSourceView（看代码）。
    //
    // 修法（已落地）：ChatPanel.tsx 的 useEffect 不再 dispatch path 类
    // active tab；非 html 文件落盘后只发 'files_changed'，让 FileTree
    // auto-pick 把首次进项目的用户落到 PREVIEW_TAB。详见 ChatPanel.tsx
    // line 161-181 + FileTree.tsx line 247-264。

    await sendChatPrompt(page, 'Generate App.jsx');

    // 验生成完后 Preview tab 是 active，不是文件 tab
    await expect(page.getByTestId('tab-preview')).toHaveAttribute('data-active', 'true');
    // 且 iframe 渲染了 mock 组件
    const previewFrame = page.frameLocator('iframe[title="Preview"]');
    await expect(previewFrame.getByTestId('mock-app-heading')).toBeVisible({ timeout: 30_000 });
  });

  // ───── F-3 ─────
  test(caseById('F-3-switch-to-source-shows-code').id, async ({ page }) => {
    await mockOpenRouter(page, {
      artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
      finishWithDone: true,
    });
    await createProject(page, 'F-3');
    await sendChatPrompt(page, 'Generate App.jsx');

    // 走 split layout 主流程：Design Files → 点 row → 右侧 Open → activeTab=path
    await gotoDesignFilesStable(page);
    await page.getByTestId('file-tree-item-App.jsx').click();
    await page.getByTestId('file-preview-open-btn').click();

    // 现在 activeTab === 'App.jsx' → FileSourceView 应该可见
    await expect(page.getByTestId('tab-file-App.jsx')).toHaveAttribute('data-active', 'true');
    const sourceContent = page.getByTestId('file-source-content');
    await expect(sourceContent).toBeVisible();
    await expect(sourceContent).toHaveAttribute('data-file-path', 'App.jsx');

    // file-source-view 是表格容器；内容里应该能搜到 mock 写入的字面量
    const sourceView = page.getByTestId('file-source-view');
    await expect(sourceView).toBeVisible();
    await expect(sourceView).toContainText('mock-app-heading');
    await expect(sourceView).toContainText('Mock App');
  });

  // ───── F-4 ─────
  test(caseById('F-4-source-preview-toggle-iframe-survives').id, async ({ page }) => {
    await mockOpenRouter(page, {
      artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
      finishWithDone: true,
    });
    await createProject(page, 'F-4');
    await sendChatPrompt(page, 'Generate App.jsx');

    // 修法（已落地）：Workspace.tsx 把 PreviewPanelSlot 提升到永久 mount,只用
    // CSS display:none 隐藏。FileTree / FileSourceView 共享一个 overlay 渲染
    // 区。这样切 Source ↔ Preview tab 时 iframe DOM 不重建,React 内部 state
    // (artifact useState、scroll 位置、iframe contentWindow marker)全部保留。

    // 先去 Preview tab，等 iframe 渲染
    await page.getByTestId('tab-preview').click();
    const previewFrame = page.frameLocator('iframe[title="Preview"]');
    await expect(previewFrame.getByTestId('mock-app-heading')).toBeVisible({ timeout: 30_000 });

    // 在 iframe contentWindow 上写一个 marker —— 父页面通过同源 access 读
    // （我们的 sandbox 是 allow-same-origin）。如果 iframe remount，window
    // 重建，marker 消失。
    const markerValue = `marker-${Date.now()}`;
    const setOk = await page.evaluate((value) => {
      const iframe = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement | null;
      if (!iframe || !iframe.contentWindow) return false;
      (iframe.contentWindow as unknown as Record<string, unknown>).__e2e_marker = value;
      return true;
    }, markerValue);
    expect(setOk, 'should be able to set a marker on iframe.contentWindow').toBe(true);

    // 切到 Design Files → 再切回 Preview
    await gotoDesignFilesStable(page);
    await expect(page.getByTestId('file-tree')).toBeVisible();
    await page.getByTestId('tab-preview').click();
    await expect(previewFrame.getByTestId('mock-app-heading')).toBeVisible({ timeout: 10_000 });

    // marker 还在 → iframe 没 remount
    const recovered = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[title="Preview"]') as HTMLIFrameElement | null;
      if (!iframe || !iframe.contentWindow) return null;
      return (iframe.contentWindow as unknown as Record<string, unknown>).__e2e_marker ?? null;
    });
    expect(recovered).toBe(markerValue);
  });

  // ───── E-1 ─────
  test(caseById('E-1-app-jsx-wins-over-index-jsx').id, async ({ page }) => {
    await mockOpenRouter(page, {
      artifactFiles: [
        { path: 'index.jsx', content: INDEX_JSX_CONTENT, asset: 'Index' },
        { path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' },
      ],
      finishWithDone: true,
    });
    await createProject(page, 'E-1');
    await sendChatPrompt(page, 'Generate App.jsx and index.jsx');

    // 走 PREVIEW_TAB 看 iframe；pickEntry(['index.jsx', 'App.jsx']) === 'App.jsx'
    // 所以 iframe 里渲染的是 App，不是 Index。
    await page.getByTestId('tab-preview').click();
    const previewFrame = page.frameLocator('iframe[title="Preview"]');

    await expect(previewFrame.getByTestId('mock-app-heading')).toBeVisible({ timeout: 30_000 });
    // bundle 里 index.jsx 也被拼进来了，但它的 default export 没被 entry 调用
    // 渲染 —— 所以 mock-index-heading 不应该出现在 DOM。
    await expect(previewFrame.getByTestId('mock-index-heading')).toHaveCount(0);

    // 文件树里两个文件都应该能看到（独立 row）
    await gotoDesignFilesStable(page);
    await expect(page.getByTestId('file-tree-item-App.jsx')).toBeVisible();
    await expect(page.getByTestId('file-tree-item-index.jsx')).toBeVisible();
  });

  // ───── E-2 ─────
  test(caseById('E-2-html-only-renders-via-html-srcdoc').id, async ({ page }) => {
    // DEBUG: temporarily DISABLED ack to capture full stack trace
    await mockOpenRouter(page, {
      artifactFiles: [{ path: 'index.html', content: HTML_ONLY_CONTENT }],
      finishWithDone: true,
    });
    await createProject(page, 'E-2');
    await sendChatPrompt(page, 'Generate index.html');

    // 路由：index.html 是 HTML path → Workspace.tsx 用 isHtmlPath() → PreviewPanel
    // PreviewPanel 内部 isHtmlOnlyBundle === true → 走 buildHtmlSrcdoc
    await page.getByTestId('tab-preview').click();
    const previewFrame = page.frameLocator('iframe[title="Preview"]');
    await expect(previewFrame.getByTestId('mock-html-only-heading')).toBeVisible({
      timeout: 30_000,
    });

    // 文件树里 PAGES section 应该有 index.html
    await gotoDesignFilesStable(page);
    await expect(page.getByTestId('file-tree-section-PAGES')).toBeVisible();
    await expect(page.getByTestId('file-tree-item-index.html')).toBeVisible();
  });

  // ───── P-1 ─────
  test(caseById('P-1-nested-path-button').id, async ({ page }) => {
    await mockOpenRouter(page, {
      artifactFiles: [
        { path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' },
        { path: 'src/components/Button.jsx', content: NESTED_BUTTON_JSX, asset: 'Button' },
      ],
      finishWithDone: true,
    });
    await createProject(page, 'P-1');
    await sendChatPrompt(page, 'Generate nested Button');

    await gotoDesignFilesStable(page);

    // 嵌套 row 应该可见 + 可点
    const nestedRow = page.getByTestId('file-tree-item-src/components/Button.jsx');
    await expect(nestedRow).toBeVisible();
    await nestedRow.click();

    // 右侧 preview pane 切到嵌套文件 + 显示 mime
    await expect(page.getByTestId('file-preview-pane')).toHaveAttribute(
      'data-file-path',
      'src/components/Button.jsx',
    );
    await expect(page.getByTestId('file-preview-filename')).toHaveText('src/components/Button.jsx');
    // 内容预览（前 80 行）应该能搜到 mock 字面量
    await expect(page.getByTestId('file-preview-source-pre')).toContainText('mock-nested-button');
  });

  // ───── P-2 ─────
  test(caseById('P-2-special-chars-space').id, async ({ page }) => {
    await mockOpenRouter(page, {
      artifactFiles: [
        { path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' },
        { path: 'src/foo bar.jsx', content: SPACE_PATH_JSX, asset: 'Foo' },
      ],
      finishWithDone: true,
    });
    await createProject(page, 'P-2');
    await sendChatPrompt(page, 'Generate space-path file');

    await gotoDesignFilesStable(page);

    const spaceRow = page.getByTestId('file-tree-item-src/foo bar.jsx');
    await expect(spaceRow).toBeVisible();
    await expect(spaceRow).toContainText('src/foo bar.jsx');
    await spaceRow.click();

    // FilePreviewPane 应该正确加载文件（不是 404 错误）
    await expect(page.getByTestId('file-preview-pane')).toHaveAttribute(
      'data-file-path',
      'src/foo bar.jsx',
    );
    await expect(page.getByTestId('file-preview-filename')).toHaveText('src/foo bar.jsx');
    // 验证内容真加载了 —— error testid 不应该存在
    await expect(page.getByTestId('file-preview-error')).toHaveCount(0);
    // pre 里应该有 mock 写入的字面量
    await expect(page.getByTestId('file-preview-source-pre')).toContainText('mock-space-path');
  });

  // ───── ER-1 ─────
  test(caseById('ER-1-nonexistent-file-tab').id, async ({ page, errorTracker }) => {
    errorTracker.acknowledge({
      // 测试用的"不存在文件"名字可能是 phantom.jsx / nonexistent.jsx 等 — 宽泛 ack
      network: [{ urlPattern: /\/api\/projects\/.+\/files\//, status: 404 }],
      console: [
        { consoleTextPattern: /Failed to load resource.*404/i },
        { consoleTextPattern: /not.*found|phantom|nonexistent/i },
      ],
    });
    // 该测试不依赖 chat —— 直接通过 API mock 让某些路径 404
    // 思路：创建项目 + 通过 dispatch 注入一个 openTabs 项并设 activeTab，
    // 让 FileSourceView 尝试 fetch 一个 server 上不存在的文件。
    await mockOpenRouter(page, {
      artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
      finishWithDone: true,
    });
    await createProject(page, 'ER-1');
    await sendChatPrompt(page, 'Generate App.jsx');

    // 拦截 nonexistent.jsx GET 让 worker 返回 404
    await page.route('**/api/projects/*/files/nonexistent.jsx', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not_found', message: 'File not found.' }),
      });
    });

    // 用真用户路径触发：在 Design Files 里没有 nonexistent.jsx，无法走"点 row"
    // 路径——这正是错误路径的现实场景：用户从浏览器历史/书签/外部链接进入。
    // 通过 page.evaluate 调 workspace dispatch（这是 e2e 里唯一允许的"不能
    // 用真实用户操作触发"的路径——就像 routing 直接跳转）。
    //
    // 注：此处 evaluate 注 JS 是为了模拟"URL 直接进入不存在的文件 tab"。
    // 真实的"navigate 到 /p/:id/files/nonexistent.jsx"路由暂未实现（当前只有
    // /p/:id），所以用 dispatch 替代是合理的最近模拟。
    const dispatched = await page.evaluate(() => {
      // open-design 没暴露 workspace dispatch 到 window —— 退而求其次：
      // 直接构造一个新 tab 进 openTabs。看是否能用模拟的 click 路径达到。
      // 当前 design 下唯一非"点 Open"的进 openTabs 路径就是 dispatch。
      // 既然没暴露，尝试用键盘事件替代 ——
      // 这个分支 e2e 不易达到，简化处理：通过 url 强行 reload + state 重置，
      // 然后看 FileSourceView 自己是否 robust。
      return false;
    });
    void dispatched;

    // 改用 fetch 直接验 worker 返回 404，确认 frontend 的 FileSourceView 在
    // 不存在文件时会显示 file-source-error。我们手动构造 dispatch 走不通，
    // 但可以验证 worker 层 404 + 一个 e2e 可达的"看不存在文件"路径：
    // 把 mockOpenRouter 改成 mock write 一个文件，然后在文件树 click 一个
    // 我们手动用 page.route 让 GET 404 的文件——但文件树自身是从 list-files
    // 拉的，list 里没有 nonexistent.jsx 它就不会出现。
    //
    // 最稳的做法：在 page.route 里把 list-files 也篡改，新增 'phantom.jsx'
    // 进 list，但 GET phantom.jsx 时 404。这样从 file tree 点过去会触发错
    // 误状态。
    await page.unrouteAll({ behavior: 'wait' });
    await page.route('**/openrouter.ai/api/v1/chat/completions*', async (route) => {
      // 之前的 mockOpenRouter 已经用完 turn，让后续请求兜底返 stop 即可
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        },
        body:
          'data: {"id":"cm-ee","object":"chat.completion.chunk","created":0,"model":"x","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
          'data: {"id":"cm-ee","object":"chat.completion.chunk","created":0,"model":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n',
      });
    });
    await page.route('**/api/projects/*/files', async (route) => {
      // 注入 phantom.jsx 进 list（真实 API 不会有，但前端不知道）
      const realResp = await route.fetch();
      const body = await realResp.json();
      const projectId = body.files[0]?.projectId ?? '';
      const phantom = {
        projectId,
        path: 'phantom.jsx',
        sha256: 'fake',
        size: 50,
        mimeType: 'text/jsx',
        updatedAt: new Date().toISOString(),
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ files: [...body.files, phantom] }),
      });
    });
    await page.route('**/api/projects/*/files/phantom.jsx', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'not_found' }),
      });
    });

    // 重新加载页面让 FileTree 重新 fetch 并看到 phantom.jsx
    await page.reload();
    await gotoDesignFilesStable(page);
    const phantomRow = page.getByTestId('file-tree-item-phantom.jsx');
    await expect(phantomRow).toBeVisible({ timeout: 10_000 });
    await phantomRow.click();
    await page.getByTestId('file-preview-open-btn').click();

    // FileSourceView 应该显示明确错误（不是空白）
    await expect(page.getByTestId('file-source-content')).toBeVisible();
    await expect(page.getByTestId('file-source-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('file-source-error')).toContainText('phantom.jsx');
  });

  // ───── A11Y-1 ─────
  test(caseById('A11Y-1-file-tree-keyboard-reachable').id, async ({ page }) => {
    await mockOpenRouter(page, {
      // 多文件 artifact —— ArrowDown 才能验真的能换 row
      artifactFiles: [
        { path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' },
        { path: 'helpers.js', content: 'export const noop = () => {};\n', asset: 'helpers' },
      ],
      finishWithDone: true,
    });
    await createProject(page, 'A11Y-1');
    await sendChatPrompt(page, 'Generate App.jsx + helpers.js');

    await gotoDesignFilesStable(page);
    const row = page.getByTestId('file-tree-item-App.jsx');
    await expect(row).toBeVisible();

    // ── WAI-ARIA Tree pattern 元数据 ──
    // 容器用 role="tree", 每个 row role="treeitem", 当前选中的 row
    // aria-selected="true"（其余 false）
    const tree = page.getByRole('tree');
    await expect(tree).toBeVisible();
    await expect(row).toHaveAttribute('role', 'treeitem');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    const helpersRow = page.getByTestId('file-tree-item-helpers.js');
    await expect(helpersRow).toHaveAttribute('aria-selected', 'false');

    // ── Roving tabindex ──
    // 唯一 tabindex=0 的 row 是当前选中的 (App.jsx); 其余 -1
    await expect(row).toHaveAttribute('tabindex', '0');
    await expect(helpersRow).toHaveAttribute('tabindex', '-1');

    // 用键盘 focus 这个 row（roving tabindex 让它接 Tab）
    await row.focus();
    // 验证 focus 真停在 row 上
    let focusedTestid = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    expect(focusedTestid).toBe('file-tree-item-App.jsx');

    // ── 方向键导航：focus 必须能换 row（不锁死在 App.jsx）──
    // 实际 DOM 序由 sectionFor + sortBy(updatedAt desc) 决定;mock fixture
    // 写两个文件时间戳很接近,不依赖具体先后 —— 验"相邻方向键能换不同 row"
    // 即可。先记下当前 focus,按一个方向键期望 focus 变了。
    const startTestid = focusedTestid; // 'file-tree-item-App.jsx'
    expect(startTestid).toBe('file-tree-item-App.jsx');

    // 既然 App.jsx 是 selected (autoPickEntry pick 它), 它会被 promote 到
    // tabstop = 0;另一行 helpers.js tabindex=-1。从 App.jsx 按 ArrowDown 或
    // ArrowUp 总能换到 helpers.js (除非它是 boundary)。
    await page.keyboard.press('ArrowDown');
    let after = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    if (after === startTestid) {
      // boundary 反向再试
      await page.keyboard.press('ArrowUp');
      after = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? null,
      );
    }
    expect(after).toBe('file-tree-item-helpers.js');
    expect(after).not.toBe(startTestid);

    // ── Home 跳到首行;End 跳到尾行 (其中之一是 App.jsx,另一是 helpers.js) ──
    await page.keyboard.press('Home');
    const homeFocus = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    await page.keyboard.press('End');
    const endFocus = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    // Home 和 End 必落在不同 row 且都在 tree 内
    expect(homeFocus).not.toBe(endFocus);
    expect([homeFocus, endFocus].sort()).toEqual(
      ['file-tree-item-App.jsx', 'file-tree-item-helpers.js'].sort(),
    );

    // 把 focus 重新放回 App.jsx,准备下一个 Enter 步骤
    await row.focus();
    focusedTestid = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') ?? null,
    );
    expect(focusedTestid).toBe('file-tree-item-App.jsx');

    // 按 Enter 应该等同点击 → previewingFile 切成 App.jsx (本来就是)
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('file-preview-pane')).toHaveAttribute(
      'data-file-path',
      'App.jsx',
    );

    // a11y 元数据观察：tablist + role=tab on tab bar
    // 用 explicit role-aware locator 检查 Design Files / Preview tabs 都有
    // 正确的 role="tab" + aria-selected。
    const designFilesTab = page.getByTestId('tab-design-files');
    await expect(designFilesTab).toHaveAttribute('role', 'tab');
    const previewTab = page.getByTestId('tab-preview');
    await expect(previewTab).toHaveAttribute('role', 'tab');
  });

  // ───── A11Y-2 (FileSourceView region/aria-live) ─────
  test('A11Y-2-file-source-view-region-and-live', async ({ page }) => {
    await mockOpenRouter(page, {
      artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
      finishWithDone: true,
    });
    await createProject(page, 'A11Y-2');
    await sendChatPrompt(page, 'Generate App.jsx');

    // 走 split layout: Design Files → click row → Open → activeTab=path → FileSourceView
    await gotoDesignFilesStable(page);
    await page.getByTestId('file-tree-item-App.jsx').click();
    await page.getByTestId('file-preview-open-btn').click();

    // 现在 FileSourceView 该 visible
    const sourceContent = page.getByTestId('file-source-content');
    await expect(sourceContent).toBeVisible();

    // ── role="region" + aria-label 让 AT 把它当独立 landmark ──
    await expect(sourceContent).toHaveAttribute('role', 'region');
    await expect(sourceContent).toHaveAttribute('aria-label', /file source/i);
    // ── aria-live="polite" 让切文件时 AT 不打断地播报 ──
    await expect(sourceContent).toHaveAttribute('aria-live', 'polite');
  });
});
