import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineWorkersConfig({
  resolve: {
    alias: {
      // Force resolution of the contracts workspace to *this* checkout's source,
      // not whatever the hoisted node_modules symlink points to. Important for
      // git-worktree setups where node_modules is shared with another branch.
      '@open-design/contracts': path.resolve(
        __dirname,
        '../../packages/contracts/src/index.ts',
      ),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false, // D1/R2 state is intentionally shared across test files
        miniflare: {
          compatibilityDate: '2025-01-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          r2Buckets: ['BLOBS'],
          bindings: {},
        },
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
