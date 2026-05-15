import { defineConfig, devices } from '@playwright/test';

// Default ports: web 5173, api 8787. Override with E2E_WEB_PORT / E2E_API_PORT
// env vars when port 5173 (or 8787) is already taken by another local dev
// server. Passing `--port ${PORT}` through to vite ensures the auto-spawned
// server lands on the requested port instead of vite's "pick next free"
// fallback that Playwright then can't find.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8787);
const baseURL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  forbidOnly: !!process.env.CI,
  // CI 上抖动重试 2 次；本地一次重试 —— 本地 dev server 在 60+ test full run
  // 时常被多个 spec 同时压（chat 面板 hydration / D1 写 / iframe srcdoc build
  // 都跟其它 spec 竞争同一份 worker 资源），单次 retry 把 flake 推回 PASS 后
  // 再看 flake 数量，比直接锁 workers=1 跑得快很多。作者要看 flake-as-flake
  // 把 E2E_RETRIES=0 注掉重跑即可。
  retries: process.env.CI ? 2 : process.env.E2E_RETRIES != null ? Number(process.env.E2E_RETRIES) : 1,
  // CI 上锁 2 workers — ubuntu-latest 4 vCPU，留余量给 dev server / browser。
  // 本地默认锁 3 workers —— Mac M-series 默认 CPU count >= 10，单 wrangler dev
  // 顶不住 10 个并发 chat 面板 hydration + iframe srcdoc build + D1 写。E2E_WORKERS
  // 覆盖（设 1 跑全串行；设 0/undefined 跑 CPU-count）。
  workers: process.env.CI
    ? 2
    : process.env.E2E_WORKERS != null
      ? Number(process.env.E2E_WORKERS)
      : 3,
  // spec 内 test 也并行（每个 case 用独立 project name 不共享 state）。
  fullyParallel: true,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // 两个 dev server — web 5173 + api 8787。dev 已经跑着的时候 reuseExistingServer
  // 直接复用，避免每次 e2e 都重启（冷启动 30s+）。
  webServer: [
    {
      command: `npm run dev --workspace=@open-design/web -- --port ${WEB_PORT} --strictPort`,
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: '..',
    },
    {
      command: 'npm run dev --workspace=@open-design/api',
      url: `http://localhost:${API_PORT}/api/projects`,
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: '..',
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
