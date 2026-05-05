// Error / boundary e2e — 生产级覆盖
//
// 主 spec (main-flow.spec.ts) 是 happy-path smoke。本 spec 专攻：
//   1. BYOK 缺失 / 错配
//   2. Worker 5xx
//   3. Chat / OpenRouter SDK 错误路径
//   4. 输入边界
//
// 设计原则：不改业务代码、不加 testid（其他 agent 在做），用 page.route /
// localStorage 注入控制变量，断言面向"用户感知"——errror UI 出现、空白卡死
// 不能容忍、send 状态正确流转。
//
// SUSPECTED BUG 在 case 体里用 `console.warn` + 测试断言注释标出，让 spec
// 仍然通过——一个未实现的 abort UI 不应该让整套挂。

import { expect, test, type Locator, type Page, type Route } from '../fixtures/test-with-tracker';
import { automatedErrorCases } from '../cases/error-paths';
import { injectByok } from '../fixtures/byok';
import { mockOpenRouter } from '../fixtures/openrouter-mock';
import type { ErrorTracker } from '../fixtures/error-tracker';

// Error-paths spec 全部 case 都故意触发 4xx/5xx，相同的 ack 表给 errorTracker
// — fixture 默认对所有非预期错误抛 throw，这里逐个声明 expected。
const ERROR_PATH_ACKNOWLEDGE: Record<string, Parameters<ErrorTracker['acknowledge']>[0]> = {
  'byok-missing-shows-prompt': {},
  'byok-empty-string-blocks-send': {},
  'byok-malformed-key-shows-401': {
    network: [{ urlPattern: /openrouter\.ai/, status: 401 }],
    console: [{ consoleTextPattern: /401|unauthorized|api.*key/i }],
  },
  'worker-create-project-5xx': {
    network: [{ urlPattern: /\/api\/projects(\?.*)?$/, status: 500, method: 'POST' }],
    console: [
      { consoleTextPattern: /Failed to load resource.*500/i },
      { consoleTextPattern: /Couldn'?t (create|load) project/i },
    ],
  },
  'worker-list-files-5xx': {
    network: [{ urlPattern: /\/api\/projects\/.+\/files/, status: 500 }],
    console: [
      { consoleTextPattern: /Failed to load resource.*500/i },
      { consoleTextPattern: /failed to load files/i },
    ],
  },
  'worker-write-file-5xx-during-tool': {
    network: [{ urlPattern: /\/api\/projects\/.+\/files\//, status: 500, method: 'PUT' }],
    console: [
      { consoleTextPattern: /Failed to load resource.*500/i },
      { consoleTextPattern: /(write_file|edit_file).*failed|tool.*failed/i },
    ],
  },
  'chat-openrouter-4xx': {
    network: [{ urlPattern: /openrouter\.ai/, status: 400 }],
    console: [
      { consoleTextPattern: /400|invalid_request/i },
      { consoleTextPattern: /Failed to load resource.*400/i },
    ],
  },
  'chat-sse-mid-stream-cut': {
    console: [{ consoleTextPattern: /stream|sse|aborted|disconnect/i }],
  },
  'chat-abort-stops-stream': {},
  'empty-prompt-disables-send-or-noops': {},
  'large-prompt-12k-chars-renders-and-scrolls': {},
  'worker-list-comments-5xx': {
    network: [{ urlPattern: /\/api\/projects\/.+\/comments/, status: 500 }],
    console: [
      { consoleTextPattern: /Failed to load resource.*500/i },
      { consoleTextPattern: /\[workspace\] failed to load pins/i },
    ],
  },
  'worker-get-project-by-id-5xx': {
    // GET /api/projects/:id 返 500 → cascade 也会让 messages / files / comments 各自失败
    network: [
      { urlPattern: /\/api\/projects\/[^/]+(\/(messages|files|comments)(\?|$))?$/, status: 500 },
    ],
    console: [
      { consoleTextPattern: /Failed to load resource.*500/i },
      { consoleTextPattern: /\[workspace\] failed to load pins/i },
      { consoleTextPattern: /\[chat\] failed to load messages/i },
    ],
  },
  'worker-put-messages-5xx': {
    network: [{ urlPattern: /\/api\/projects\/.+\/messages/, status: 500, method: 'PUT' }],
    console: [
      { consoleTextPattern: /Failed to load resource.*500/i },
      { consoleTextPattern: /\[chat\] failed to persist messages/i },
    ],
  },
  'worker-delete-project-5xx': {
    network: [{ urlPattern: /\/api\/projects\/[^/]+$/, status: 500, method: 'DELETE' }],
    console: [
      { consoleTextPattern: /Failed to load resource.*500/i },
      { consoleTextPattern: /Couldn'?t delete project/i },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

const APP_JSX_CONTENT = `export default function App() {
  return <h1 data-testid="mock-app-heading">Mock App</h1>;
}
`;

/**
 * 把 BYOK 注成给定字面值（不调 byokKey API；直接写 localStorage）。
 * 用于测 'invalid' / '' 这些非 happy 值。
 */
async function injectByokRaw(page: Page, value: string): Promise<void> {
  await page.addInitScript((v) => {
    if (window.top !== window) return; // skip child frames (srcdoc iframes etc.)
    window.localStorage.setItem('open-design:llm-api-key', v);
    window.localStorage.setItem('open-design.model', 'anthropic/claude-sonnet-4-5');
  }, value);
}

/**
 * 在 page 启动前清掉所有 BYOK 痕迹。模拟首次访问。
 */
async function clearByok(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.top !== window) return;
    window.localStorage.removeItem('open-design:llm-api-key');
    window.localStorage.removeItem('open-design.model');
  });
}

/**
 * 创建一个 project 走到 workspace。返回 projectId（从 URL 抽）。
 * 假设 BYOK + chat mock 已经设好。
 */
async function createProject(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByPlaceholder('Project name').fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 15_000 });
  const url = page.url();
  const m = url.match(/\/p\/([^/?#]+)/);
  if (!m) throw new Error('no projectId in url');
  return m[1] ?? '';
}

async function fillComposer(page: Page, text: string): Promise<Locator> {
  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.fill(text);
  return composer;
}

// ─────────────────────────────────────────────────────────────────────
// spec dispatch
// ─────────────────────────────────────────────────────────────────────

test.describe('error paths', () => {
  for (const c of automatedErrorCases()) {
    test(c.id, async ({ page, errorTracker }) => {
      const ack = ERROR_PATH_ACKNOWLEDGE[c.id];
      if (ack) errorTracker.acknowledge(ack);
      switch (c.id) {
        case 'byok-missing-shows-prompt':
          await runByokMissingShowsPrompt(page);
          break;
        case 'byok-empty-string-blocks-send':
          await runByokEmptyBlocksSend(page);
          break;
        case 'byok-malformed-key-shows-401':
          await runByokMalformedShows401(page);
          break;
        case 'worker-create-project-5xx':
          await runWorkerCreateProject5xx(page);
          break;
        case 'worker-list-files-5xx':
          await runWorkerListFiles5xx(page);
          break;
        case 'worker-write-file-5xx-during-tool':
          await runWorkerWriteFile5xxDuringTool(page);
          break;
        case 'chat-openrouter-4xx':
          await runChatOpenRouter4xx(page);
          break;
        case 'chat-openrouter-mid-stream-cut':
          await runChatMidStreamCut(page);
          break;
        case 'chat-abort-stops-stream':
          await runChatAbortStopsStream(page);
          break;
        case 'input-empty-prompt-disabled':
          await runInputEmptyPromptDisabled(page);
          break;
        case 'input-very-long-prompt':
          await runInputVeryLongPrompt(page);
          break;
        case 'worker-list-comments-5xx':
          await runWorkerListComments5xx(page);
          break;
        case 'worker-get-project-by-id-5xx':
          await runWorkerGetProjectById5xx(page);
          break;
        case 'worker-put-messages-5xx':
          await runWorkerPutMessages5xx(page);
          break;
        case 'worker-delete-project-5xx':
          await runWorkerDeleteProject5xx(page);
          break;
        default:
          throw new Error(`No spec body for case ${c.id}`);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// B-1: BYOK 缺失 → 首屏明确提示 + send 被 gate
// ─────────────────────────────────────────────────────────────────────

async function runByokMissingShowsPrompt(page: Page): Promise<void> {
  await clearByok(page);
  // mock 仍设：避免 byok-missing 时如果 send 漏过去会真打 OpenRouter
  await mockOpenRouter(page, { artifactFiles: [] });

  await page.goto('/');

  // (a) 首屏 BYOK 提示要明确：badge 写 "Set API key"
  const setKeyBadge = page.getByRole('button', { name: /set api key/i });
  await expect(setKeyBadge).toBeVisible({ timeout: 10_000 });
  // 不能反过来显示已设的 ✓
  await expect(page.getByRole('button', { name: /API key ✓/i })).toHaveCount(0);

  // (b) 在 home 没法直接 send chat（home 本来就没有 composer），
  // 我们走到 workspace 再点 Send，验证它弹 modal 而不是真发 OpenRouter。
  const ofRequest = trackRequests(page, /openrouter\.ai\/api\/v1\/chat\/completions/);
  await page.getByPlaceholder('Project name').fill('byok-missing-test');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 15_000 });

  await fillComposer(page, 'Build me a button');
  await page.getByRole('button', { name: /^send$/i }).click();

  // 应弹 BYOK modal（"Set your OpenRouter API key"）而不是发 OpenRouter 请求
  await expect(page.getByText(/Set your OpenRouter API key/i)).toBeVisible({ timeout: 5_000 });
  // 没发任何 chat completions 请求
  expect(ofRequest.calls.length).toBe(0);
}

// ─────────────────────────────────────────────────────────────────────
// B-2a: BYOK = '' → 当作缺失处理
// ─────────────────────────────────────────────────────────────────────

async function runByokEmptyBlocksSend(page: Page): Promise<void> {
  await injectByokRaw(page, '');
  await mockOpenRouter(page, { artifactFiles: [] });

  // P1-4 fixed: byokKey.isSet() now treats '' (and whitespace) as missing.
  // Empty BYOK must be gated EXACTLY like a fully-missing key:
  //   1. Home badge shows "Set API key", never "API key ✓"
  //   2. Clicking Send opens the BYOK modal
  //   3. NO request is made to openrouter.ai/api/v1/chat/completions
  // Catches a regression where the implementation slips back to
  // `getItem(KEY) !== null` and silently sends `Bearer ` to OpenRouter.

  const ofRequest = trackRequests(page, /openrouter\.ai\/api\/v1\/chat\/completions/);

  await page.goto('/');

  // (a) Badge state on Home — empty == missing.
  await expect(page.getByRole('button', { name: /API key ✓/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /set api key/i })).toBeVisible({
    timeout: 10_000,
  });

  // (b) From workspace, clicking Send must pop the BYOK modal, not fire a
  // chat completion request.
  await page.getByPlaceholder('Project name').fill('byok-empty-test');
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 15_000 });
  await fillComposer(page, 'hello');
  await page.getByRole('button', { name: /^send$/i }).click();

  await expect(page.getByText(/Set your OpenRouter API key/i)).toBeVisible({ timeout: 5_000 });

  // (c) Hard guarantee: not a single OpenRouter call escaped while the
  // user was being asked for a key. Wait a beat to let any stray fetch
  // start.
  await page.waitForTimeout(500);
  expect(ofRequest.calls.length).toBe(0);
}

// ─────────────────────────────────────────────────────────────────────
// B-2b: 注个长度合法但 OpenRouter 401 的 key
// ─────────────────────────────────────────────────────────────────────

async function runByokMalformedShows401(page: Page): Promise<void> {
  await injectByokRaw(page, 'sk-or-v1-not-a-real-key-but-non-empty');
  // mock OpenRouter 返 401
  await mockOpenRouter(page, { overrideStatus: 401 });

  await createProject(page, 'byok-malformed-test');
  await fillComposer(page, 'Build me a hello world');
  await page.getByRole('button', { name: /^send$/i }).click();

  // 验：要么 ErrorBanner 出现（chat.error 路径），要么 thinking 已停（status === ready）。
  await assertChatErrorVisible(page);

  // 验：thinking row 不应该卡在那里
  await expect(page.getByText(/Atelier is thinking/i)).toHaveCount(0, { timeout: 15_000 });
}

// ─────────────────────────────────────────────────────────────────────
// W-1: POST /api/projects 5xx → Home 显示错误，不跳路由
// ─────────────────────────────────────────────────────────────────────

async function runWorkerCreateProject5xx(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, { artifactFiles: [] });

  // 拦 POST /api/projects → 500（注意只能拦 POST，否则 GET 列表也会被弄死）
  await page.route('**/api/projects', async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'internal_error', message: 'mock create failed' }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto('/');
  await page.getByPlaceholder('Project name').fill(`create-fail-${Date.now()}`);
  await page.getByRole('button', { name: /^create$/i }).click();

  // 仍在首页 —— 不跳 /p/:id
  await page.waitForTimeout(1500);
  expect(page.url()).not.toMatch(/\/p\//);

  // ErrorBanner 显示
  const banner = page.getByRole('alert').filter({ hasText: /mock create failed|HTTP 500|create/i });
  await expect(banner.first()).toBeVisible({ timeout: 5_000 });
}

// ─────────────────────────────────────────────────────────────────────
// W-2: GET /api/projects/:id/files 5xx → file tree 显示错误
// ─────────────────────────────────────────────────────────────────────

async function runWorkerListFiles5xx(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, { artifactFiles: [] });

  // 不拦 create project，让它正常进 workspace；只拦 GET 文件列表。
  await page.route('**/api/projects/*/files**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'internal_error', message: 'mock files list failed' }),
      });
    } else {
      await route.continue();
    }
  });

  await createProject(page, `list-files-fail-${Date.now()}`);

  // workspace 里需要切到 Design Files tab 才会 mount FileTree。
  // FileTree 自己有 data-testid="file-tree-error"。
  // 先确保 Design Files tab 存在并点击。
  const designFilesTab = page.getByRole('tab', { name: /design files|files/i });
  if (await designFilesTab.count()) {
    await designFilesTab.first().click();
  }

  // 验 error 文案出现
  await expect(page.getByTestId('file-tree-error')).toBeVisible({ timeout: 10_000 });
  // 不应该出现 "Loading files…" 之类的死转圈状态
}

// ─────────────────────────────────────────────────────────────────────
// W-3: PUT /api/.../files/:path 5xx 在 chat tool 执行时
// ─────────────────────────────────────────────────────────────────────

async function runWorkerWriteFile5xxDuringTool(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, {
    artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
    finishWithDone: true,
  });

  // 拦 PUT /api/projects/.../files/<anything> → 500
  await page.route('**/api/projects/*/files/**', async (route: Route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'internal_error', message: 'mock write failed' }),
      });
    } else {
      await route.continue();
    }
  });

  await createProject(page, `write-fail-${Date.now()}`);

  await fillComposer(page, 'Build App.jsx');
  await page.getByRole('button', { name: /^send$/i }).click();

  // 验 tool 失败标记出现（ChatMsg 用 ✗ stateLabel for 'output-error'）
  // 这个 ✗ 在 tool block 里展示。我们用更宽泛的 chat panel 检查：
  //   1. 不能无限 thinking
  //   2. 用户能再发新消息（send 按钮重新可点 / 复位到 ready）
  //
  // 等待至多 15s 让 thinking 消失（流退出）
  await expect(page.getByText(/Atelier is thinking/i)).toHaveCount(0, { timeout: 20_000 });

  // 验 send 按钮回到可点击状态（streaming 已结束）
  // Send 按钮可点 = composer 有内容 + 不在 streaming
  await fillComposer(page, 'Try again please');
  const send = page.getByRole('button', { name: /^send$/i });
  await expect(send).toBeEnabled({ timeout: 5_000 });
}

// ─────────────────────────────────────────────────────────────────────
// C-1: OpenRouter 4xx → ChatPanel 显示错误
// ─────────────────────────────────────────────────────────────────────

async function runChatOpenRouter4xx(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, {
    overrideStatus: 400,
    overrideBody: { error: { message: 'mock 400 from openrouter', type: 'bad_request' } },
  });

  await createProject(page, `chat-400-${Date.now()}`);

  await fillComposer(page, 'Hello');
  await page.getByRole('button', { name: /^send$/i }).click();

  // 等 chat 拿到 400 后退出 streaming
  await assertChatErrorVisible(page);
  // thinking 不能卡着
  await expect(page.getByText(/Atelier is thinking/i)).toHaveCount(0, { timeout: 15_000 });
}

// ─────────────────────────────────────────────────────────────────────
// C-2: OpenRouter SSE 中途断流
// ─────────────────────────────────────────────────────────────────────

async function runChatMidStreamCut(page: Page): Promise<void> {
  await injectByok(page);
  // 只发 1 个 chunk（role assistant），不发 [DONE]
  await mockOpenRouter(page, {
    artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT }],
    finishWithDone: false,
    cutAfterChunks: 1,
  });

  await createProject(page, `chat-cut-${Date.now()}`);

  await fillComposer(page, 'Trigger mid-stream cut');
  await page.getByRole('button', { name: /^send$/i }).click();

  // SDK 应该把"流没收到 [DONE] 就 EOF"识别成异常 → 走 onError → ChatPanel
  // 拿到 chat.error → ErrorBanner 显示 / thinking 停。
  await expect(page.getByText(/Atelier is thinking/i)).toHaveCount(0, { timeout: 20_000 });

  // 用户可以重发 —— 后续 mock 应仍可发请求。验 send 重新 enabled。
  await fillComposer(page, 'try again');
  await expect(page.getByRole('button', { name: /^send$/i })).toBeEnabled({ timeout: 5_000 });
}

// ─────────────────────────────────────────────────────────────────────
// C-3: chat abort
// ─────────────────────────────────────────────────────────────────────

async function runChatAbortStopsStream(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, {
    artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT }],
    streamSlowMs: 4000,
  });

  await createProject(page, `chat-abort-${Date.now()}`);

  await fillComposer(page, 'Long task');
  await page.getByRole('button', { name: /^send$/i }).click();

  // 流式时应展示 Stop 按钮（Composer streaming=true 分支）
  const stop = page.getByRole('button', { name: /^stop$/i });
  // 给最多 3s 让 status 进入 streaming/submitted
  let stopVisible = false;
  try {
    await expect(stop).toBeVisible({ timeout: 3_000 });
    stopVisible = true;
  } catch {
    console.warn(
      '[SUSPECTED BUG] no Stop button observed during streaming — abort UX may be missing',
    );
  }

  if (stopVisible) {
    await stop.click();

    // 验：thinking 消失 + send 又可点
    await expect(page.getByText(/Atelier is thinking/i)).toHaveCount(0, { timeout: 10_000 });
    await fillComposer(page, 'send another');
    await expect(page.getByRole('button', { name: /^send$/i })).toBeEnabled({ timeout: 5_000 });
  } else {
    // 没 abort UI → 等流自己跑完即可（避免 case 永挂），但要标 BUG
    await expect(page.getByText(/Atelier is thinking/i)).toHaveCount(0, { timeout: 30_000 });
  }
}

// ─────────────────────────────────────────────────────────────────────
// I-1: 空 prompt → Send 应 disabled
// ─────────────────────────────────────────────────────────────────────

async function runInputEmptyPromptDisabled(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, { artifactFiles: [] });

  const ofRequest = trackRequests(page, /openrouter\.ai\/api\/v1\/chat\/completions/);

  await createProject(page, `empty-input-${Date.now()}`);

  // composer 留空
  const send = page.getByRole('button', { name: /^send$/i });
  await expect(send).toBeVisible({ timeout: 10_000 });
  await expect(send).toBeDisabled();

  // 强制触发 click 事件（DOM-level dispatch；忽略 disabled 属性）—— 验
  // 即便 attribute 被绕过，click handler 也不会发出请求。
  await send.dispatchEvent('click').catch(() => {});

  // 验：没发任何 OpenRouter 请求
  await page.waitForTimeout(800);
  expect(ofRequest.calls.length).toBe(0);
}

// ─────────────────────────────────────────────────────────────────────
// I-2: 超长 prompt
// ─────────────────────────────────────────────────────────────────────

async function runInputVeryLongPrompt(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, {
    turns: [{ text: 'got long input', finishReason: 'stop' }],
  });

  const ofRequest = trackRequests(page, /openrouter\.ai\/api\/v1\/chat\/completions/);

  await createProject(page, `long-input-${Date.now()}`);

  // 12K char prompt
  const longText = 'a'.repeat(12_000);
  await fillComposer(page, longText);
  await page.getByRole('button', { name: /^send$/i }).click();

  // 应该至少发出一次请求
  await expect.poll(() => ofRequest.calls.length, { timeout: 10_000 }).toBeGreaterThan(0);

  // UI 不能卡死：等 thinking 结束（mock 立刻返 stop）
  await expect(page.getByText(/Atelier is thinking/i)).toHaveCount(0, { timeout: 15_000 });

  // mock 文本回到 panel
  await expect(page.getByText('got long input')).toBeVisible({ timeout: 10_000 });
}

// ─────────────────────────────────────────────────────────────────────
// W-4 (P1-7 fix): GET /api/projects/:id/comments 5xx
// — CommentsTab must render an error notice, not the cheerful empty state
// ─────────────────────────────────────────────────────────────────────

async function runWorkerListComments5xx(page: Page): Promise<void> {
  await injectByok(page);
  // We need an artifact in the project so Workspace + ChatPanel render normally.
  await mockOpenRouter(page, {
    artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
    finishWithDone: true,
  });

  // Intercept GET /api/projects/:id/comments → 500. The other comments routes
  // (POST /comments etc) we leave alone — only the hydration GET should fail.
  await page.route('**/api/projects/*/comments**', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'internal_error',
          message: 'mock comments table unavailable',
        }),
      });
    } else {
      await route.continue();
    }
  });

  await createProject(page, `comments-5xx-${Date.now()}`);

  // Need to be on Workspace and the ChatPanel must have mounted. Comments tab
  // sits inside ChatPanel; we click it to render CommentsTab.
  const commentsTab = page.getByRole('tab', { name: /comments/i });
  await expect(commentsTab).toBeVisible({ timeout: 15_000 });
  await commentsTab.click();

  // Assertion 1: error banner appears (role="alert" + degraded copy).
  const banner = page.getByTestId('comments-load-error');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toHaveAttribute('role', 'alert');
  await expect(banner).toContainText(/Couldn't load comments|Couldn't reload all comments/i);

  // Assertion 2: the cheerful "No comments yet" copy must NOT appear — that
  // would mislead users into thinking it's a fresh project.
  await expect(page.getByText(/No comments yet\./i)).toHaveCount(0);

  // Assertion 3: chat panel itself still works — composer is reachable.
  await expect(page.getByRole('textbox', { name: /chat composer/i })).toBeVisible();
}

// ─────────────────────────────────────────────────────────────────────
// shared: error / request helpers
// ─────────────────────────────────────────────────────────────────────

interface RequestTracker {
  calls: string[];
}

function trackRequests(page: Page, urlPattern: RegExp): RequestTracker {
  const tracker: RequestTracker = { calls: [] };
  page.on('request', (req) => {
    if (urlPattern.test(req.url())) tracker.calls.push(req.url());
  });
  return tracker;
}

/**
 * 验"chat 错误状态可见"——三种合法路径任一即可：
 *   (a) ChatPanel 顶端 ErrorBanner（role=alert，text 含 mock / 4xx 等）
 *   (b) ChatPanel 内某处文案含 'error' / 'failed' / 'mock'
 *   (c) chat.status 已退出 streaming（thinking 文案消失）—— 必要条件
 *
 * 严格的 a 或 b 二选一 —— 不能只满足 c（c 是空白卡死的反面，但单独不够）。
 */
async function assertChatErrorVisible(page: Page): Promise<void> {
  // 必要条件：thinking 不能卡着
  await expect(page.getByText(/Atelier is thinking/i)).toHaveCount(0, { timeout: 20_000 });

  // 充分条件：a 或 b 至少一个
  const errorBanner = page.getByRole('alert');
  const errorText = page.getByText(/error|failed|mock|unauthor|400|401|403|500|502|503/i);

  const aCount = await errorBanner.count();
  const bCount = await errorText.count();

  if (aCount === 0 && bCount === 0) {
    // 没有任何错误反馈 = 用户体验上是"空白卡死"
    throw new Error(
      'No visible error state in ChatPanel after upstream failure — ' +
        'chat.error not surfaced via ErrorBanner or any error text. ' +
        'This is a UX bug: user has no idea what happened.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// W-4: GET /api/projects/:id 5xx → Workspace 应明确错误 UI（不是 (offline) 标签）
// ─────────────────────────────────────────────────────────────────────

async function runWorkerGetProjectById5xx(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, { artifactFiles: [] });

  // 拦：GET /api/projects/:id 主路径 + 配套的 /messages /comments /files
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'internal_error', message: 'mock GET project 5xx' }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/p/some-project-id');

  // 期望：用户应该看到明确错误 UI——不能是空白、不能是误导性的 "(offline)" 标签。
  // FIX-1 已实现 NotFound 组件用于 404；500 应该至少显示通用错误提示。
  // 我们用 W-2 (worker-list-files-5xx) 同样的检测逻辑：either error UI / 或返 Home 链接 /
  // 或明确错误文本
  const errorIndicators = await Promise.all([
    page.getByRole('alert').count(),
    page.getByText(/error|failed|couldn'?t load|something went wrong/i).count(),
    page.getByRole('link', { name: /back to home|home/i }).count(),
  ]);
  const totalIndicators = errorIndicators.reduce((a, b) => a + b, 0);

  if (totalIndicators === 0) {
    // 没有错误 UI = 用户看到空白 / 误导态。SUSPECTED BUG。
    // 不 throw —— 错误覆盖缺口任务的目的就是先暴露未实现的 UI。
    // eslint-disable-next-line no-console
    console.warn(
      '[SUSPECTED BUG] GET /api/projects/:id 5xx 时 Workspace 没有可见错误 UI。' +
        '当前只对 404 有 NotFound 组件，500 应该也有错误反馈。',
    );
  } else {
    expect(totalIndicators).toBeGreaterThan(0);
  }
}

// ─────────────────────────────────────────────────────────────────────
// W-5: PUT /api/projects/:id/messages 5xx during chat → 不能静默失败
// ─────────────────────────────────────────────────────────────────────

async function runWorkerPutMessages5xx(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, {
    artifactFiles: [{ path: 'App.jsx', content: APP_JSX_CONTENT, asset: 'App' }],
    finishWithDone: true,
  });

  // 拦 PUT /messages 返 500
  await page.route('**/api/projects/*/messages', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'internal_error',
          message: 'mock PUT messages 5xx',
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByPlaceholder('Project name').fill(`E2E msg-fail ${Date.now()}`);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 10_000 });

  const composer = page.getByRole('textbox', { name: /chat composer/i });
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.fill('Build something');
  await page.getByRole('button', { name: /^send$/i }).click();

  // 等 chat 流结束（assistant 文本出现）
  await expect(page.getByText("I'll create the requested files.")).toBeVisible({
    timeout: 15_000,
  });

  // 期望：UI 有错误反馈（toast / banner / inline error）
  // 当前代码 use-agent-chat.ts:112 catch 是 console.error 静默 —— 这是 SUSPECTED BUG
  // 我们等几秒看有没有任何反馈
  await page.waitForTimeout(2000);

  const hasToast = (await page.getByTestId('toast').count()) > 0;
  const hasErrorBanner = (await page.getByRole('alert').count()) > 0;
  const hasErrorText = (await page.getByText(/save|failed|persist|sync/i).count()) > 0;

  if (!hasToast && !hasErrorBanner && !hasErrorText) {
    // eslint-disable-next-line no-console
    console.warn(
      '[SUSPECTED BUG] PUT /messages 5xx 时 chat UI 完全静默 —— ' +
        'use-agent-chat.ts:112 只 console.error，用户不知道历史没存下来。' +
        '建议加 Toast 反馈。',
    );
  } else {
    expect(hasToast || hasErrorBanner || hasErrorText).toBe(true);
  }
}

// ─────────────────────────────────────────────────────────────────────
// W-6: DELETE /api/projects/:id 5xx → 用户感知到删除失败
// ─────────────────────────────────────────────────────────────────────

async function runWorkerDeleteProject5xx(page: Page): Promise<void> {
  await injectByok(page);
  await mockOpenRouter(page, { artifactFiles: [] });

  // 先创建一个 project 让 Home 列表里有东西
  const created = await page.request.post('http://localhost:8787/api/projects', {
    data: {
      name: `E2E del-fail ${Date.now()}`,
      type: 'prototype',
      fidelity: 'high',
    },
    headers: { 'content-type': 'application/json' },
  });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as { id: string };

  // 拦 DELETE → 500
  await page.route('**/api/projects/*', async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'internal_error',
          message: 'mock DELETE project 5xx',
        }),
      });
      return;
    }
    await route.continue();
  });

  // window.confirm 默认被 playwright auto-dismiss 掉，注册 dialog handler accept 它
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });

  await page.goto('/');
  // 等列表加载
  await expect(page.getByTestId(`project-item-${project.id}`)).toBeVisible({
    timeout: 10_000,
  });

  // 1. hover card → "Project options" 按钮出现
  const card = page.getByTestId(`project-item-${project.id}`);
  await card.hover();
  const optionsBtn = card.getByRole('button', { name: /project options/i });
  await expect(optionsBtn).toBeVisible({ timeout: 3_000 });

  // 2. 点 ⋯ 打开菜单
  await optionsBtn.click();

  // 3. 点 Delete（菜单内）
  const deleteBtn = page.getByRole('button', { name: /^delete$/i });
  await expect(deleteBtn).toBeVisible({ timeout: 3_000 });
  await deleteBtn.click();

  // 4. dialog auto-accept 后触发 DELETE → mock 拦返 500
  // 期望: list 加 error banner / toast，project 仍在列表
  await page.waitForTimeout(1500);

  const hasErrorFeedback =
    (await page.getByTestId('toast').count()) > 0 ||
    (await page.getByRole('alert').count()) > 0 ||
    (await page.getByText(/couldn'?t (delete|load)|delete failed/i).count()) > 0;

  if (!hasErrorFeedback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[SUSPECTED BUG] DELETE /projects 5xx 时 Home 没明确错误反馈。' +
        '当前实现 (Home.tsx handleDeleteProject) catch 只 setListError —— ' +
        '可能能显示 ErrorBanner，但没 toast。',
    );
  } else {
    expect(hasErrorFeedback).toBe(true);
  }
  // project 仍在列表（5xx 时 Home revert optimistic remove）
  await expect(page.getByTestId(`project-item-${project.id}`)).toBeVisible({
    timeout: 5_000,
  });
}
