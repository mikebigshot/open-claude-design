import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mirror vite.config.ts: pin workspace packages to the CURRENT
      // checkout's source. Without this, vitest resolves
      // `@open-design/iframe-runtime` and `@open-design/contracts` through
      // node_modules — which the worktree setup symlinks back to the MAIN
      // repo's checkout, hiding local edits and giving tests a stale view
      // of the package source.
      '@open-design/iframe-runtime': path.resolve(__dirname, '../../packages/iframe-runtime/src'),
      '@open-design/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/routes/**', // UI 组件 → e2e 范围
        'src/components/**', // UI 组件 → e2e 范围
        'src/features/**/*.tsx', // UI 组件 → e2e 范围
        'src/features/chat/agent.ts', // SDK 包装层
        'src/features/chat/use-agent-chat.ts', // hook 包装层
      ],
      thresholds: {
        perFile: true,
        // 阈值 = 实测 - 5%（floor 到整数）
        // iframe-bridge.ts 实测: stmt 93.75%, branch 65.38%
        'src/lib/iframe-bridge.ts': { statements: 88 },
        // byok-key.ts 实测: stmt 100%
        'src/lib/byok-key.ts': { statements: 95 },
        // file-utils.ts 实测: stmt 100%, branch 100%
        'src/features/workspace/file-utils.ts': { statements: 100, branches: 100 },
        // workspace.tsx 实测: stmt 96.53%, branch 95.74%
        'src/state/workspace.tsx': { statements: 91, branches: 90 },
        // system-prompt.ts 实测: stmt 100%
        'src/features/chat/system-prompt.ts': { statements: 95 },
      },
    },
  },
});
