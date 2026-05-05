import { defineConfig } from 'vitest/config';

// Unit tests only — `test/**` runs via vitest.config.integration.ts under
// @cloudflare/vitest-pool-workers. The default `vitest run` here would
// otherwise try to load `cloudflare:test` (only available in pool-workers)
// and fail.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportOnFailure: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts', // bootstrap glue
        'src/routes/**', // covered by integration tests
        'src/storage/**', // covered indirectly via routes integration
      ],
      // apps/api 当前 src 没有 unit-tested 模块（routes/storage 全在 integration 层覆盖）；
      // perFile thresholds 留空。保留 coverage config 给未来扩展用。
    },
  },
});
