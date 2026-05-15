// Persistence + multi-project isolation e2e spec.
//
// 数据准备走 page.request.* 直接打 worker（不走 UI fixture）—— 比 UI ops
// 快 ~10x、稳定性高、避免 mock OpenRouter 串扰。
//
// 跑测试：
//   npm run test:e2e --workspace=@open-design/e2e -- specs/persistence.spec.ts
//
// 注意事项：
//   - mockOpenRouter 拦 OpenRouter SSE，但 worker 自己的 /api/projects、
//     /api/projects/:id/files、/api/projects/:id/messages 都不拦
//   - 每个 case 用独立 timestamp 后缀的 project name，避免互相影响
//   - reload 后等 chat-history 显式可见（避免 strictmode race）

import { test, expect, type Page } from '../fixtures/test-with-tracker';
import type { Project } from '@open-design/contracts';
import { automatedPersistenceCases } from '../cases/persistence';
import { injectByok } from '../fixtures/byok';
import { mockOpenRouter } from '../fixtures/openrouter-mock';

const APP_JSX = `export default function App() {
  return (
    <div>
      <h1 data-testid="mock-app-heading">Hello A</h1>
    </div>
  );
}
`;

const APP_JSX_B = `export default function App() {
  return (
    <div>
      <h1 data-testid="mock-app-heading">Hello B</h1>
    </div>
  );
}
`;

// ───── helpers ─────

interface CreateProjectOpts {
  name: string;
  type?: 'prototype' | 'design_system';
  fidelity?: 'wireframe' | 'high';
}

async function createProjectViaApi(page: Page, opts: CreateProjectOpts): Promise<Project> {
  const res = await page.request.post('http://localhost:8787/api/projects', {
    data: {
      name: opts.name,
      type: opts.type ?? 'prototype',
      fidelity: opts.fidelity ?? 'high',
    },
    headers: { 'content-type': 'application/json' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Project;
}

async function writeFileViaApi(
  page: Page,
  projectId: string,
  path: string,
  content: string,
  mimeType = 'text/jsx',
): Promise<void> {
  const res = await page.request.put(
    `http://localhost:8787/api/projects/${projectId}/files/${path}`,
    {
      data: { path, content, mimeType },
      headers: { 'content-type': 'application/json' },
    },
  );
  expect(res.ok()).toBeTruthy();
}

async function getFileBytesViaApi(
  page: Page,
  projectId: string,
  path: string,
): Promise<{ status: number; body: string }> {
  const res = await page.request.get(
    `http://localhost:8787/api/projects/${projectId}/files/${path}`,
  );
  return { status: res.status(), body: await res.text() };
}

interface UIMessageInput {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<Record<string, unknown>>;
}

/**
 * Task 2 后 messages 必须关联 chatId。helper 默认拉 GET /chats 取第一条
 * （若无则新建），让旧测试代码无需手写 chatId。caller 也可显式传 chatId。
 */
async function ensureChatIdViaApi(page: Page, projectId: string): Promise<string> {
  const listRes = await page.request.get(`http://localhost:8787/api/projects/${projectId}/chats`);
  expect(listRes.ok()).toBeTruthy();
  const { chats } = (await listRes.json()) as { chats: Array<{ id: string }> };
  if (chats.length > 0) return chats[0]!.id;
  // create one
  const id = crypto.randomUUID();
  const createRes = await page.request.post(
    `http://localhost:8787/api/projects/${projectId}/chats`,
    {
      data: { id, title: null },
      headers: { 'content-type': 'application/json' },
    },
  );
  expect(createRes.status()).toBe(201);
  return id;
}

async function putMessagesViaApi(
  page: Page,
  projectId: string,
  messages: UIMessageInput[],
  chatId?: string,
): Promise<void> {
  const targetChatId = chatId ?? (await ensureChatIdViaApi(page, projectId));
  const res = await page.request.put(`http://localhost:8787/api/projects/${projectId}/messages`, {
    data: { chatId: targetChatId, messages },
    headers: { 'content-type': 'application/json' },
  });
  expect(res.ok()).toBeTruthy();
}

async function deleteProjectViaApi(page: Page, projectId: string): Promise<void> {
  const res = await page.request.delete(`http://localhost:8787/api/projects/${projectId}`);
  // 204 OK or 404 acceptable (already gone)
  expect([204, 404]).toContain(res.status());
}

/**
 * 等 ChatPanel 完成 hydration —— 先看 chat-history 容器存在，再判断是否
 * 至少一条 chat-msg-* 出现（如果期待非空）。
 */
async function waitForChatHistoryReady(page: Page, opts: { expectMessages: boolean }) {
  await expect(page.getByTestId('chat-history')).toBeVisible({ timeout: 15_000 });
  if (opts.expectMessages) {
    await expect(page.locator('[data-testid^="chat-msg-"]').first()).toBeVisible({
      timeout: 15_000,
    });
  }
}

/**
 * 跑完一次 chat（用 Composer 发 prompt + 等 mock done）。
 * 默认 mock 已经在 beforeEach 里注册带 artifactFiles。
 */
async function sendChatPrompt(page: Page, prompt: string) {
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.fill(prompt);
  await page.getByRole('button', { name: /^send$/i }).click();
  // 等 mock 文本回灌进 chat history
  await expect(page.getByText("I'll create the requested files.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('All done.', { exact: true })).toBeVisible({ timeout: 15_000 });
}

// ───── spec body ─────

test.describe('persistence + multi-project', () => {
  // Serial: persistence cases reload pages and assert prior D1 state. Under
  // parallel load, another spec's project creation can write into the same
  // D1 between reload + assert, flaking the round-trip. Serial avoids it.
  test.describe.configure({ mode: 'serial' });

  for (const c of automatedPersistenceCases()) {
    test(c.id, async ({ page, errorTracker }) => {
      // 故意触发错误的两个 case：声明 expected
      if (c.id === 'error-project-not-found') {
        errorTracker.acknowledge({
          network: [{ urlPattern: /\/api\/projects\/nonexistent/, status: 404 }],
          console: [
            { consoleTextPattern: /Failed to load resource.*404/i },
            { consoleTextPattern: /\[chat\] failed to load messages/i },
            { consoleTextPattern: /\[workspace\] failed to load pins/i },
            { consoleTextPattern: /project not found/i },
          ],
        });
      } else if (c.id === 'error-home-projects-api-5xx') {
        errorTracker.acknowledge({
          network: [{ urlPattern: /\/api\/projects(\?|$)/, status: 500, method: 'GET' }],
          console: [
            { consoleTextPattern: /Failed to load resource.*500/i },
            { consoleTextPattern: /Couldn'?t load projects/i },
          ],
        });
      }
      // 默认每个 case 都注入 BYOK + mock 一段写 App.jsx 的流；个别 case 会覆盖。
      await injectByok(page);
      await mockOpenRouter(page, {
        artifactFiles: [{ path: 'App.jsx', content: APP_JSX, asset: 'App' }],
        finishWithDone: true,
      });

      switch (c.id) {
        case 'chat-history-reload-restores-full-thread':
          await runChatHistoryReloadFullThread(page);
          break;
        case 'chat-history-reload-mid-stream':
          await runChatHistoryReloadMidStream(page);
          break;
        case 'chat-history-empty-state-reload':
          await runChatHistoryEmptyStateReload(page);
          break;
        case 'files-reload-content-preserved':
          await runFilesReloadContentPreserved(page);
          break;
        case 'files-tree-active-tab-after-reload':
          await runFilesTreeActiveTabAfterReload(page);
          break;
        case 'home-shows-existing-projects':
          await runHomeShowsExistingProjects(page);
          break;
        case 'home-click-opens-existing-project':
          await runHomeClickOpensExistingProject(page);
          break;
        case 'multi-project-files-isolated':
          await runMultiProjectFilesIsolated(page);
          break;
        case 'error-project-not-found':
          await runErrorProjectNotFound(page);
          break;
        case 'error-home-projects-api-5xx':
          await runErrorHomeProjects5xx(page);
          break;
        default:
          throw new Error(`No spec body for case ${c.id}`);
      }
    });
  }
});

// ───── Chat history persistence ─────

async function runChatHistoryReloadFullThread(page: Page): Promise<void> {
  // 用 API 直接 PUT thread 比走 chat 流稳定 ——
  // 我们要测的是 GET /messages 的 hydration 路径，不是 SDK→Worker 写入。
  const project = await createProjectViaApi(page, { name: `H1 chat ${Date.now()}` });

  // messages PK 是 (project_id, id) composite，所以同 id 在不同 project 下不会撞；
  // 这里仍然带 project.id 前缀做调试可读性 —— 出 bug 时一眼能看出是哪个 project 的消息。
  const k = `h1-${project.id.slice(0, 8)}`;
  const messages: UIMessageInput[] = [
    {
      id: `${k}-u1`,
      role: 'user',
      parts: [{ type: 'text', text: 'Build a hello world' }],
    },
    {
      id: `${k}-a1`,
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Sure thing.' },
        {
          type: 'tool-write_file',
          toolCallId: `${k}-tc-1`,
          state: 'output-available',
          input: { path: 'App.jsx', content: APP_JSX },
          output: { ok: true, path: 'App.jsx' },
        },
      ],
    },
    {
      id: `${k}-u2`,
      role: 'user',
      parts: [{ type: 'text', text: 'Now make it pink' }],
    },
    {
      id: `${k}-a2`,
      role: 'assistant',
      parts: [{ type: 'text', text: 'Done.' }],
    },
  ];
  await putMessagesViaApi(page, project.id, messages);

  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });
  await waitForChatHistoryReady(page, { expectMessages: true });

  // 验所有 4 条按时间序恢复
  const items = page.locator('[data-testid^="chat-msg-"]');
  await expect(items).toHaveCount(4);

  // 验 user 消息字字符 match
  await expect(page.getByTestId('chat-msg-user-0')).toContainText('Build a hello world');
  await expect(page.getByTestId('chat-msg-assistant-1')).toContainText('Sure thing.');
  await expect(page.getByTestId('chat-msg-user-2')).toContainText('Now make it pink');
  await expect(page.getByTestId('chat-msg-assistant-3')).toContainText('Done.');

  // a11y: chat-history 容器有 scrollable 区，至少要 keyboard 可达
  // —— Tab 可以聚焦到 composer textarea
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await composer.focus();
  await expect(composer).toBeFocused();
}

async function runChatHistoryReloadMidStream(page: Page): Promise<void> {
  const project = await createProjectViaApi(page, { name: `H2 mid ${Date.now()}` });

  // 注入一个特殊 mock：第一轮就 stop 不 done()——模拟 server "中途死了" 的回合。
  // 我们 reload 后看 user msg 是否还在。
  await page.unroute('**/openrouter.ai/api/v1/chat/completions*').catch(() => {});
  await mockOpenRouter(page, {
    turns: [
      {
        text: 'Working on it…',
        finishReason: 'stop',
      },
    ],
  });

  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: /chat composer/i })).toBeVisible({
    timeout: 15_000,
  });

  // Send 一条；wrap-sendMessage 会立刻 PUT keepalive
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await composer.fill('Save me even mid-stream');
  await page.getByRole('button', { name: /^send$/i }).click();

  // 等 user msg 进 history（同步进 chat.messages → render）
  await expect(page.getByTestId('chat-msg-user-0')).toContainText('Save me even mid-stream', {
    timeout: 15_000,
  });
  // 等 assistant 至少把 "Working on it…" 显示出来再 reload，确保 PUT 已经发出
  await expect(page.getByText('Working on it…')).toBeVisible({ timeout: 15_000 });

  // 给 keepalive PUT 一点时间送达 worker（fetch keepalive 不阻塞 reload）
  await page.waitForTimeout(500);
  await page.reload();

  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });
  await waitForChatHistoryReady(page, { expectMessages: true });

  // user msg 必须还在
  await expect(page.locator('[data-testid="chat-msg-user-0"]')).toContainText(
    'Save me even mid-stream',
  );
  // 至少要有一条消息（user 一定有；assistant 视 onFinish 是否触发）
  const count = await page.locator('[data-testid^="chat-msg-"]').count();
  expect(count).toBeGreaterThanOrEqual(1);

  // 不应该卡 loading
  await expect(page.getByTestId('chat-history')).toBeVisible();
}

async function runChatHistoryEmptyStateReload(page: Page): Promise<void> {
  const project = await createProjectViaApi(page, { name: `H3 empty ${Date.now()}` });

  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });
  await waitForChatHistoryReady(page, { expectMessages: false });
  // 没消息：chat-msg-* 应为 0
  await expect(page.locator('[data-testid^="chat-msg-"]')).toHaveCount(0);

  await page.reload();

  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });
  await waitForChatHistoryReady(page, { expectMessages: false });
  // reload 后还是 0 条（没有 ghost message / loading 卡死）
  await expect(page.locator('[data-testid^="chat-msg-"]')).toHaveCount(0);

  // composer 可用：键盘可达
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await expect(composer).toBeVisible();
  await composer.focus();
  await expect(composer).toBeFocused();

  // 没有 ErrorBanner（验空状态不是错误状态）
  await expect(page.getByRole('alert')).toHaveCount(0);
}

// ───── File persistence ─────

async function runFilesReloadContentPreserved(page: Page): Promise<void> {
  const project = await createProjectViaApi(page, { name: `F1 file ${Date.now()}` });

  // 直接 PUT 文件内容（不走 chat → tool → API 这条路，这条路在别的 case 验）
  await writeFileViaApi(page, project.id, 'App.jsx', APP_JSX);

  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });

  // FileTree auto-pick → Preview tab；要看文件树先点 Design Files tab
  // 等 file 至少落在某处
  await page.waitForTimeout(500);

  // 切到 Design Files tab 验文件存在
  // TabBar 上 Design Files tab —— 看 TabBar 实现是 button + label
  // Design Files tab 通过 dispatch set_active_tab(DESIGN_FILES_TAB) 触发
  // —— 我们直接点 toolbar 上的 'FILE TREE' / 'Design Files' 文本
  const designFilesTab = page.getByTestId('tab-design-files');
  await designFilesTab.click();

  await expect(page.getByText('App.jsx', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  // Reload
  await page.reload();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });

  // reload 后再切去 Design Files tab
  await page.getByTestId('tab-design-files').click();
  await expect(page.getByText('App.jsx', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  // 内容还在 R2：拉一下 raw 字字符 match
  const fetched = await getFileBytesViaApi(page, project.id, 'App.jsx');
  expect(fetched.status).toBe(200);
  expect(fetched.body).toBe(APP_JSX);
}

async function runFilesTreeActiveTabAfterReload(page: Page): Promise<void> {
  const project = await createProjectViaApi(page, { name: `F2 tree ${Date.now()}` });
  await writeFileViaApi(page, project.id, 'App.jsx', APP_JSX);

  await page.goto(`/p/${project.id}`);
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });

  // 第一次进项目：FileTree auto-pick 把 activeTab 设为 PREVIEW —— 应该看到 Preview tab 是 active
  // 但 file 已经在树里。切 Design Files tab → 文件可见。
  await page.getByTestId('tab-design-files').click();
  await expect(page.getByText('App.jsx', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  // 关掉 page，重新打开：autoPickedProjects Set 是 module-scope，但 page reload 会清模块
  await page.reload();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });

  // reload 后默认还是 PREVIEW tab（auto-pick）。手动切 Design Files —— 仍可见
  await page.getByTestId('tab-design-files').click();
  await expect(page.getByText('App.jsx', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  // 文件 row 是 WAI-ARIA treeitem —— 键盘可达（FIX-D 加了 role="tree" + ↑↓ 导航）
  const fileRow = page.getByRole('treeitem', { name: /App\.jsx/i }).first();
  await expect(fileRow).toBeVisible();
}

// ───── Multi-project ─────

async function runHomeShowsExistingProjects(page: Page): Promise<void> {
  // Create 3 projects via API
  const ts = Date.now();
  const p1 = await createProjectViaApi(page, { name: `M1 alpha ${ts}` });
  // 让 createdAt 严格递增（D1 timestamps 微秒级别可能撞）
  await page.waitForTimeout(20);
  const p2 = await createProjectViaApi(page, { name: `M1 beta ${ts}` });
  await page.waitForTimeout(20);
  const p3 = await createProjectViaApi(page, { name: `M1 gamma ${ts}` });

  await page.goto('/');
  // 等 list 加载
  await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 15_000 });
  // 三个 card 至少都在
  await expect(page.getByTestId(`project-item-${p1.id}`)).toBeVisible();
  await expect(page.getByTestId(`project-item-${p2.id}`)).toBeVisible();
  await expect(page.getByTestId(`project-item-${p3.id}`)).toBeVisible();

  // 验顺序 —— DOM 顺序（gamma < beta < alpha），最新创建在最前
  const ids = await page
    .locator('[data-testid^="project-item-"]')
    .evaluateAll((nodes: Element[]) => nodes.map((n) => (n as HTMLElement).dataset.testid ?? ''));
  const idxAlpha = ids.indexOf(`project-item-${p1.id}`);
  const idxBeta = ids.indexOf(`project-item-${p2.id}`);
  const idxGamma = ids.indexOf(`project-item-${p3.id}`);
  expect(idxAlpha).toBeGreaterThan(idxBeta);
  expect(idxBeta).toBeGreaterThan(idxGamma);

  // a11y: Tab + Enter 进入项目（每张卡片是 role="button" + tabIndex=0）
  // 注意：Home 表单 input 在前面，可能要 Tab 多次。直接 focus 测试 Enter。
  await page.getByTestId(`project-item-${p3.id}`).focus();
  // ProjectCard onKeyDown 处理 Enter / Space
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/p/${p3.id}`), { timeout: 15_000 });
}

async function runHomeClickOpensExistingProject(page: Page): Promise<void> {
  const project = await createProjectViaApi(page, { name: `M2 open ${Date.now()}` });

  // 预置历史 + 文件
  await writeFileViaApi(page, project.id, 'App.jsx', APP_JSX);
  const k = `m2-${project.id.slice(0, 8)}`;
  await putMessagesViaApi(page, project.id, [
    {
      id: `${k}-u`,
      role: 'user',
      parts: [{ type: 'text', text: 'M2 prepared message' }],
    },
    {
      id: `${k}-a`,
      role: 'assistant',
      parts: [{ type: 'text', text: 'Restored on click' }],
    },
  ]);

  await page.goto('/');
  await expect(page.getByTestId('project-list')).toBeVisible({ timeout: 15_000 });
  const card = page.getByTestId(`project-item-${project.id}`);
  await expect(card).toBeVisible();
  await card.click();

  await expect(page).toHaveURL(new RegExp(`/p/${project.id}`), { timeout: 15_000 });
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });

  await waitForChatHistoryReady(page, { expectMessages: true });
  // 历史恢复
  await expect(page.getByTestId('chat-msg-user-0')).toContainText('M2 prepared message');
  await expect(page.getByTestId('chat-msg-assistant-1')).toContainText('Restored on click');

  // 文件恢复 —— 切 Design Files tab
  await page.getByTestId('tab-design-files').click();
  await expect(page.getByText('App.jsx', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function runMultiProjectFilesIsolated(page: Page): Promise<void> {
  const ts = Date.now();
  const p1 = await createProjectViaApi(page, { name: `M3 P1 ${ts}` });
  const p2 = await createProjectViaApi(page, { name: `M3 P2 ${ts}` });
  await writeFileViaApi(page, p1.id, 'A.jsx', APP_JSX);
  await writeFileViaApi(page, p2.id, 'B.jsx', APP_JSX_B);

  // 打开 P1 → 验只有 A.jsx
  await page.goto(`/p/${p1.id}`);
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tab-design-files').click();
  await expect(page.getByText('A.jsx', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('B.jsx', { exact: true })).toHaveCount(0);

  // 切去 P2 → 只有 B.jsx
  await page.goto(`/p/${p2.id}`);
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tab-design-files').click();
  await expect(page.getByText('B.jsx', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('A.jsx', { exact: true })).toHaveCount(0);

  // 再回 P1：仍只有 A.jsx
  await page.goto(`/p/${p1.id}`);
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tab-design-files').click();
  await expect(page.getByText('A.jsx', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('B.jsx', { exact: true })).toHaveCount(0);
}

// ───── Errors ─────

async function runErrorProjectNotFound(page: Page): Promise<void> {
  // 预先 unroute mock —— 这条 case 不走 OpenRouter
  // 直接打不存在的 id
  const fakeId = 'nonexistent-project-id-' + Date.now();
  // 防止之前 dev session 残留同名 project（极端低概率）
  await deleteProjectViaApi(page, fakeId).catch(() => {});

  await page.goto(`/p/${fakeId}`);

  // 修法（2026-05-03 已落地）：404 时渲染专门的 NotFound 状态，有明确文案 +
  // "Back to Home" 链接，而不是 fallback 到 "(offline)" 项目名继续渲染整个 shell。

  // not-found 容器可见 + 含明确文案
  const notFound = page.getByTestId('workspace-not-found');
  await expect(notFound).toBeVisible({ timeout: 15_000 });
  await expect(notFound).toContainText(/not found/i);
  // 包含 fakeId 让用户能辨别打错了哪个 id
  await expect(notFound).toContainText(fakeId);

  // 必须有 "Back to Home" 链接（role=link 跳到 /），让用户从 fake URL 逃出去
  const backLink = page.getByRole('link', { name: /back to home/i });
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveAttribute('href', '/');

  // 防伪：不应同时渲染 workspace 主体（file tree / chat panel）。
  await expect(page.getByTestId('chat-history')).toHaveCount(0);
  await expect(page.getByTestId('file-tree')).toHaveCount(0);
}

async function runErrorHomeProjects5xx(page: Page): Promise<void> {
  // 拦 GET /api/projects 返 500，再 goto Home。
  // 用 fail-toggle 让 Retry 后能恢复成 200 + 真实空数组（验 retry 行为）。
  let failNext = true;
  await page.route('**/api/projects', async (route, req) => {
    if (req.method() === 'GET') {
      if (failNext) {
        await route.fulfill({
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: 'internal', message: 'Simulated server error' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projects: [] }),
        });
      }
    } else {
      await route.continue();
    }
  });

  await page.goto('/');
  // 等 page 渲染完
  await expect(page.getByText('Open Claude Design', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── (1) ErrorBanner 必须出现，文案明确 ──
  const errorBanner = page.getByRole('alert');
  await expect(errorBanner.first()).toBeVisible({ timeout: 15_000 });
  await expect(errorBanner.first()).toContainText(/Couldn't load projects|Simulated server error/);

  // ── (2) 关键反伪：5xx 时 "No projects yet" 空态绝对不能出现 ──
  // 旧实现 catch 分支 setProjects([]) → 触发 filtered.length===0 → 渲染
  // project-list-empty。修复后 listError 存在时跳过 empty placeholder。
  await expect(page.getByTestId('project-list-empty')).toHaveCount(0);

  // ── (3) Retry button 必须可见、可点 ──
  const retryButton = page.getByTestId('project-list-retry');
  await expect(retryButton).toBeVisible({ timeout: 5_000 });
  await expect(retryButton).toBeEnabled();

  // ── (4) Retry 行为：点击重试 → 如果后端恢复，错误消失，恢复正常空态 ──
  failNext = false;
  await retryButton.click();
  // ErrorBanner 消失
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 10_000 });
  // 现在显示真实的"无项目"空态
  await expect(page.getByTestId('project-list-empty')).toBeVisible({ timeout: 10_000 });
}
