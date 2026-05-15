import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { existsSync } from 'node:fs';

// Resolve packages from the nearest ancestor that has node_modules. Handles two layouts:
//   Main checkout:  <repo>/apps/web                                       → 2 levels up to <repo>/
//   Worktree:       <repo>/.claude/worktrees/<name>/apps/web              → 5 levels up to <repo>/
// npm workspaces hoist to <repo>/node_modules; per-package installs land in apps/web/node_modules.
function worktreeNodeModules(...segments: string[]): string {
  // 1. Local node_modules (per-package install, e.g. version-conflict packages)
  const local = path.resolve(__dirname, 'node_modules', ...segments);
  if (existsSync(local)) return local;
  // 2. Main-checkout repo root node_modules (2 levels up from apps/web)
  const mainRepoRoot = path.resolve(__dirname, '../..', 'node_modules', ...segments);
  if (existsSync(mainRepoRoot)) return mainRepoRoot;
  // 3. Worktree repo root node_modules (5 levels up from apps/web inside worktree)
  const wsRoot = path.resolve(__dirname, '../../../../..', 'node_modules', ...segments);
  if (existsSync(wsRoot)) return wsRoot;
  // 4. Worktree → main checkout apps/web/node_modules
  const mainAppsWeb = path.resolve(__dirname, '../../../../../apps/web/node_modules', ...segments);
  if (existsSync(mainAppsWeb)) return mainAppsWeb;
  return local; // fallback — let vite report the proper error
}

export default defineConfig(({ mode }) => {
  // 同时读 .env / .env.local / .env.<mode> 以及 shell env，用于本地端口 override
  const env = { ...process.env, ...loadEnv(mode, __dirname, '') };
  return {
  plugins: [
    react({
      babel: {
        plugins: [
          ['babel-plugin-styled-components', { displayName: true, fileName: false, ssr: false }],
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // CRITICAL: pin our own workspace packages to the *current* checkout
      // (main repo OR worktree). Without this, vite resolves
      // `@open-design/iframe-runtime` via node_modules — which the worktree
      // setup symlinks to the MAIN repo's node_modules, whose
      // `@open-design/iframe-runtime` symlink in turn points at the MAIN
      // repo's `packages/iframe-runtime`. Net effect: editing
      // `packages/iframe-runtime/src/*.ts` inside a worktree had no visible
      // effect during dev (vite kept loading the main repo's old source),
      // breaking the "edit + e2e verify" loop. `path.resolve(__dirname,
      // '../../packages/...')` walks 2 levels up from `apps/web` to the
      // current checkout's root — correct in both layouts.
      '@open-design/iframe-runtime': path.resolve(__dirname, '../../packages/iframe-runtime/src'),
      '@open-design/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
      // Spike test deps — resolved from main workspace when worktree has no node_modules
      ai: worktreeNodeModules('ai'),
      '@openrouter/ai-sdk-provider': worktreeNodeModules('@openrouter', 'ai-sdk-provider'),
      '@ai-sdk/provider-utils': worktreeNodeModules('@ai-sdk', 'provider-utils'),
      '@ai-sdk/react': worktreeNodeModules('@ai-sdk', 'react'),
      // CRITICAL: pin zod to the v4 copy in apps/web/node_modules. Without
      // this, vite's dep optimizer picked up a root-hoisted zod 3.22.3 (left
      // by some other transitive dep), but the AI SDK's `asSchema` expects
      // the v4 standard-schema marker `"~standard"` on every schema. The
      // mismatch manifested as `TypeError: schema is not a function` when
      // sending the first chat message — asSchema fell through its branches
      // and tried `schema()` as a last-ditch fallback.
      zod: worktreeNodeModules('zod'),
    },
    // Dedupe ensures the browser only ever loads ONE copy of zod (any
    // transitive resolver still ends up at apps/web/node_modules/zod).
    dedupe: ['zod'],
  },
  server: {
    // 端口 / proxy target 可被 .env.local 或 shell env 覆盖（用于并行起多个 dev server）。
    // 不设置任何 override 时行为不变：5173 + proxy 到 8787。
    port: Number(env.VITE_DEV_PORT) || 5173,
    proxy: {
      '/api': {
        target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
  };
});
