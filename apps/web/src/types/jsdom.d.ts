// Minimal ambient declaration for `jsdom` so TS doesn't error on the
// `import { JSDOM } from 'jsdom'` in
// `apps/web/src/features/preview/__tests__/iframe-error-placeholder.test.tsx`.
// The runtime package is in devDeps; `@types/jsdom` is not installed (and we
// only use a tiny surface area) — declaring the shape inline avoids pulling
// in the full DOM types twice.

declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}
