// iframe-error-placeholder.test.tsx — DOM-level test for the in-iframe error
// placeholder rendered by the inline-error-handler IIFE.
//
// The IIFE lives in `@open-design/iframe-runtime`'s inline-error-handler.ts;
// it's normally stringified and injected into the preview iframe's srcdoc.
// Here we evaluate it inside vitest's jsdom window so we can observe the
// real DOM mutations + assert against the rendered placeholder structure.
//
// Why this test exists: build-srcdoc.test.ts only verifies the srcdoc STRING
// carries the IIFE and marker constant. That's necessary but not sufficient —
// we also need to verify that when the iframe loads the srcdoc and Babel
// throws, the IIFE actually paints a visible placeholder containing the
// error name, message, and offending line excerpt (the user-facing payload).
//
// Repro context (verbatim from the bug report):
//   App.jsx line 44: `{ delay: 7300, text: "  [PENDING]  把"能跑就行"..." }`
//   → Babel: "Unexpected token, expected ',' (44:32)"
//   → Without this handler the iframe renders blank.

import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  buildSrcdoc,
  buildInlineErrorHandlerScript,
  INLINE_ERROR_PLACEHOLDER_ATTR,
  INLINE_ERROR_SOURCE_GLOBAL,
  INLINE_ERROR_RENDER_GLOBAL,
} from '@open-design/iframe-runtime';

// Bug-report shape: nested ASCII double-quotes in a string literal — the
// real-world artifact that triggered the empty-iframe regression.
const BAD_APP_JSX = [
  'const messages = [',
  '  { delay: 1000, text: "first" },',
  '  { delay: 7300, text: "  [PENDING]  把"能跑就行"..." },',
  '];',
  'function App() {',
  '  return <div>{messages[0].text}</div>;',
  '}',
].join('\n');

interface ErrorRenderInfo {
  name?: string;
  message?: string;
  lineno?: number;
  colno?: number;
  filename?: string;
}

type CodesignWindow = Window & {
  [INLINE_ERROR_SOURCE_GLOBAL]?: string;
  [INLINE_ERROR_RENDER_GLOBAL]?: (info: ErrorRenderInfo) => void;
};

/**
 * Spin up an isolated jsdom window+document, stash the agent source, and
 * evaluate the IIFE inside it. Each call returns a fully self-contained
 * environment — listeners from prior tests can't leak in because each test
 * gets its own jsdom instance.
 *
 * vitest's shared jsdom env doesn't reset window listeners between `it`s,
 * which would cause IIFE listeners from prior tests to fire on later tests'
 * synthesized errors. JSDOM-per-test isolates that.
 */
function createIsolatedIframeEnv(sourceText: string | undefined): {
  window: CodesignWindow;
  document: Document;
  dom: JSDOM;
} {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as CodesignWindow;
  if (sourceText !== undefined) {
    win[INLINE_ERROR_SOURCE_GLOBAL] = sourceText;
  }
  // Evaluate the IIFE inside the jsdom window context. The Function ctor on
  // the jsdom window binds the IIFE's `this` and global lookups to that
  // window, so addEventListener('error', ...) lands on the jsdom EventTarget.
  const fn = new (win as unknown as { Function: typeof Function }).Function(
    buildInlineErrorHandlerScript(),
  );
  fn.call(win);
  return { window: win, document: dom.window.document, dom };
}

function makeErrorEvent(win: CodesignWindow, init: ErrorEventInit): Event {
  // Use the jsdom window's ErrorEvent ctor so the event is dispatchable on
  // its window target (cross-window event ctors throw in jsdom).
  const ErrorEventCtor = (win as unknown as { ErrorEvent: typeof ErrorEvent }).ErrorEvent;
  return new ErrorEventCtor('error', init);
}

describe('inline-error-handler — placeholder rendering inside the iframe', () => {

  it('paints the placeholder when a Babel-style SyntaxError fires globally', () => {
    const { window: win, document: doc } = createIsolatedIframeEnv(BAD_APP_JSX);
    expect(typeof win[INLINE_ERROR_RENDER_GLOBAL]).toBe('function');

    // Simulate the Babel SyntaxError. ErrorEvent in jsdom supports message,
    // filename, lineno, colno, error fields — same shape Babel emits.
    const err = new SyntaxError("Unexpected token, expected ',' (3:32)");
    win.dispatchEvent(
      makeErrorEvent(win, {
        message: err.message,
        filename: 'bundle.jsx',
        lineno: 3,
        colno: 32,
        error: err,
      }),
    );

    const placeholder = doc.querySelector(`[${INLINE_ERROR_PLACEHOLDER_ATTR}]`);
    expect(placeholder).not.toBeNull();
    // The placeholder is role=alert so screen readers announce the failure.
    expect(placeholder!.getAttribute('role')).toBe('alert');
    expect(placeholder!.getAttribute('aria-live')).toBe('assertive');

    // Error name + message are surfaced in dedicated child slots.
    const nameEl = placeholder!.querySelector('[data-codesign-error-name]');
    const msgEl = placeholder!.querySelector('[data-codesign-error-message]');
    expect(nameEl?.textContent).toBe('SyntaxError');
    expect(msgEl?.textContent).toContain("Unexpected token, expected ','");
    expect(msgEl?.textContent).toContain('(3:32)');

    // Line excerpt is rendered for the offending source line. The bug-report
    // shape puts the nested quote on the messages line — line 3 of BAD_APP_JSX.
    const excerptLine = placeholder!.querySelector('[data-codesign-error-line]');
    expect(excerptLine).not.toBeNull();
    expect(excerptLine!.textContent).toContain('[PENDING]');

    // Caret marker should appear at column 32 (the second `"`). We just
    // assert the caret element exists and contains a `^`.
    const caret = placeholder!.querySelector('[data-codesign-error-caret]');
    expect(caret).not.toBeNull();
    expect(caret!.textContent).toContain('^');
  });

  it('parses (line:col) out of the error message when ErrorEvent lacks lineno/colno', () => {
    // Babel Standalone in some browsers only writes the position into the
    // message body, not the ErrorEvent fields. Verify we still locate the
    // line excerpt from the message-embedded coordinates alone.
    const { window: win, document: doc } = createIsolatedIframeEnv(BAD_APP_JSX);

    const err = new SyntaxError("Unexpected token, expected ',' (3:32)");
    win.dispatchEvent(
      makeErrorEvent(win, {
        message: err.message,
        // intentionally omit lineno/colno
        error: err,
      }),
    );

    const placeholder = doc.querySelector(`[${INLINE_ERROR_PLACEHOLDER_ATTR}]`);
    expect(placeholder).not.toBeNull();
    const excerptLine = placeholder!.querySelector('[data-codesign-error-line]');
    expect(excerptLine?.textContent).toContain('[PENDING]');
  });

  it('does NOT paint when #root already has children (runtime error post-mount)', () => {
    // Custom-bootstrapped jsdom env where #root already has a mounted app.
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body><div id="root"><div data-existing="app-content">App content</div></div></body></html>',
      { runScripts: 'outside-only' },
    );
    const win = dom.window as unknown as CodesignWindow;
    win[INLINE_ERROR_SOURCE_GLOBAL] = 'function App(){ return <div/>; }';
    new (win as unknown as { Function: typeof Function }).Function(
      buildInlineErrorHandlerScript(),
    ).call(win);

    win.dispatchEvent(
      makeErrorEvent(win, {
        message: "Cannot read properties of undefined (reading 'foo')",
        lineno: 5,
        colno: 1,
        error: new TypeError("Cannot read properties of undefined (reading 'foo')"),
      }),
    );

    // Placeholder NOT rendered — the rendered app survives.
    expect(dom.window.document.querySelector(`[${INLINE_ERROR_PLACEHOLDER_ATTR}]`)).toBeNull();
    expect(dom.window.document.querySelector('[data-existing="app-content"]')).not.toBeNull();
  });

  it('also catches unhandledrejection (promise rejection before mount)', () => {
    const { window: win, document: doc } = createIsolatedIframeEnv(
      'function App(){ return <div/>; }',
    );

    // Build a PromiseRejectionEvent on the jsdom window. jsdom doesn't
    // expose the constructor on older versions, so we fall back to a plain
    // Event with `reason` defined.
    const reason = new Error('Module load failed: cannot find react');
    const ev = new (win as unknown as { Event: typeof Event }).Event('unhandledrejection');
    Object.defineProperty(ev, 'reason', { value: reason });
    Object.defineProperty(ev, 'promise', { value: Promise.reject(reason).catch(() => {}) });
    win.dispatchEvent(ev);

    const placeholder = doc.querySelector(`[${INLINE_ERROR_PLACEHOLDER_ATTR}]`);
    expect(placeholder).not.toBeNull();
    const msgEl = placeholder!.querySelector('[data-codesign-error-message]');
    expect(msgEl?.textContent).toContain('Module load failed');
  });

  it('ignores resource-load failures (img/script 404)', () => {
    const { window: win, document: doc } = createIsolatedIframeEnv(
      'function App(){ return <div/>; }',
    );

    // jsdom: resource-load error has target=<element>, message=''
    const img = doc.createElement('img');
    doc.body.appendChild(img);
    const ev = new (win as unknown as { Event: typeof Event }).Event('error');
    Object.defineProperty(ev, 'target', { value: img });
    win.dispatchEvent(ev);

    // Placeholder NOT rendered for non-runtime errors.
    expect(doc.querySelector(`[${INLINE_ERROR_PLACEHOLDER_ATTR}]`)).toBeNull();
  });

  it('only renders once even when multiple errors fire', () => {
    const { window: win, document: doc } = createIsolatedIframeEnv(BAD_APP_JSX);

    win.dispatchEvent(
      makeErrorEvent(win, {
        message: 'first error (3:1)',
        error: new SyntaxError('first error (3:1)'),
      }),
    );
    win.dispatchEvent(
      makeErrorEvent(win, {
        message: 'second error (5:1)',
        error: new SyntaxError('second error (5:1)'),
      }),
    );

    const placeholders = doc.querySelectorAll(`[${INLINE_ERROR_PLACEHOLDER_ATTR}]`);
    expect(placeholders.length).toBe(1);
    // First-write-wins: the second error message must NOT clobber the first.
    expect(placeholders[0]!.querySelector('[data-codesign-error-message]')?.textContent).toContain(
      'first error',
    );
  });

  it('survives missing source-text global (no excerpt, but placeholder still paints)', () => {
    const { window: win, document: doc } = createIsolatedIframeEnv(undefined);

    win.dispatchEvent(
      makeErrorEvent(win, {
        message: 'Some error (1:1)',
        error: new Error('Some error (1:1)'),
      }),
    );

    const placeholder = doc.querySelector(`[${INLINE_ERROR_PLACEHOLDER_ATTR}]`);
    expect(placeholder).not.toBeNull();
    expect(placeholder!.querySelector('[data-codesign-error-message]')?.textContent).toContain(
      'Some error',
    );
    // No excerpt block when source is missing.
    expect(placeholder!.querySelector('[data-codesign-error-excerpt]')).toBeNull();
  });
});

describe('buildSrcdoc — bad-JSX bundle integration', () => {
  it('produces a srcdoc whose inline handler script renders the placeholder when invoked', () => {
    // E2E-shape integration: produce the actual srcdoc the host would mount
    // into the iframe, then verify the embedded handler renders correctly
    // when triggered. We load the entire srcdoc into a jsdom window with
    // `runScripts: 'dangerously'` so the inline `<script>` tags execute
    // naturally — modulo external CDN scripts which jsdom can't fetch
    // (Babel / React / Tailwind 404, but the inline error-handler runs
    // before those because it's earlier in <head>).
    const html = buildSrcdoc([
      {
        path: 'App.jsx',
        mimeType: 'text/jsx',
        content: BAD_APP_JSX,
      },
    ]);

    // Sanity: the handler + marker constant + source-capture are all present
    // in the actual srcdoc output (not just the helper).
    expect(html).toContain(INLINE_ERROR_PLACEHOLDER_ATTR);
    expect(html).toContain(INLINE_ERROR_RENDER_GLOBAL);
    expect(html).toContain('[PENDING]');

    // Build a jsdom that actually executes the srcdoc's inline scripts.
    // We block fetching external resources so CDN script tags don't dial
    // out — the test runs offline. The inline error-handler is an inline
    // <script> with no src, so it executes synchronously.
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: undefined, // no external fetches
      pretendToBeVisual: true,
    });
    const win = dom.window as unknown as CodesignWindow;

    // The error-handler IIFE registers a render function on window.
    expect(typeof win[INLINE_ERROR_RENDER_GLOBAL]).toBe('function');
    // Source capture happened in-page.
    expect(win[INLINE_ERROR_SOURCE_GLOBAL]).toContain('[PENDING]');

    // The captured source is the FULL agent script which includes the
    // React-globals prelude (~14 lines), the file marker, then the agent
    // file body — so the offending `[PENDING]` line is not at line 3 of
    // the bad JSX file. Find its actual line number in the captured source.
    const capturedSource = win[INLINE_ERROR_SOURCE_GLOBAL]!;
    const lineIndex = capturedSource.split('\n').findIndex((l) => l.includes('[PENDING]'));
    expect(lineIndex).toBeGreaterThanOrEqual(0);
    const lineno = lineIndex + 1;

    // Trigger the error using the in-page constructor so the dispatch
    // target matches the listener's host window.
    win.dispatchEvent(
      makeErrorEvent(win, {
        message: `Unexpected token, expected ',' (${lineno}:32)`,
        lineno,
        colno: 32,
        error: new SyntaxError(`Unexpected token, expected ',' (${lineno}:32)`),
      }),
    );

    const placeholder = dom.window.document.querySelector(
      `[${INLINE_ERROR_PLACEHOLDER_ATTR}]`,
    );
    expect(placeholder).not.toBeNull();
    const msgEl = placeholder!.querySelector('[data-codesign-error-message]');
    expect(msgEl?.textContent).toContain('Unexpected token');
    expect(placeholder!.querySelector('[data-codesign-error-line]')?.textContent).toContain(
      '[PENDING]',
    );
  });
});
