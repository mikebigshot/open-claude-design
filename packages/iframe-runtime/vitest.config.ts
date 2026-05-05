import { defineConfig } from 'vitest/config';

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
        'src/index.ts', // re-export only
      ],
      thresholds: {
        perFile: true,
        // 阈值 = 实测 - 5%（floor 到整数）
        // build-srcdoc.ts 实测: stmt 99.1%, branch 97.61%
        'src/build-srcdoc.ts': { statements: 94, branches: 92 },
        // editmode-protocol.ts 实测: stmt 100%, branch 100%
        'src/editmode-protocol.ts': { statements: 100, branches: 100 },
        // overlay.ts 实测: stmt 100%
        'src/overlay.ts': { statements: 95 },
        // tweaks-bridge.ts 实测: stmt 100%
        'src/tweaks-bridge.ts': { statements: 95 },
        // cached-root.ts 实测: stmt 100%
        'src/cached-root.ts': { statements: 95 },
      },
    },
  },
});
