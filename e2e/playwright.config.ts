import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:5173';

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  forbidOnly: !!process.env.CI,
  // CI 上抖动重试 2 次；本地不重试，让作者立刻看到 flake。
  retries: process.env.CI ? 2 : 0,
  // CI 上锁 2 workers — ubuntu-latest 4 vCPU，留余量给 dev server / browser。
  // 本地不限，按 CPU 跑。
  workers: process.env.CI ? 2 : undefined,
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
      command: 'npm run dev --workspace=@open-design/web',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: '..',
    },
    {
      command: 'npm run dev --workspace=@open-design/api',
      url: 'http://localhost:8787/api/projects',
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
