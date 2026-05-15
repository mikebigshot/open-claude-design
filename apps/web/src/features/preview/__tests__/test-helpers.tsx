// Shared test infrastructure for PreviewPanel.test.tsx and friends.
//
// PreviewPanel is the most-integrated component in the app: it owns the
// parent ↔ iframe bridge, accumulates pending Edit-mode style edits, and
// queues chat submissions for the Comment / Draw flows. Testing it requires
// stubbing four cross-cutting concerns:
//
//   1. PreviewIframe — replaced with a stub that synchronously hands the
//      parent a fake `<iframe>` whose `contentWindow.postMessage` is a spy.
//      This lets us drive the IframeBridge without jsdom's iframe lifecycle
//      (which fires `load` / `unload` events at unpredictable times for the
//      empty srcdoc).
//
//   2. `@/lib/api` — `WorkspaceProvider` hydrates pins on mount and
//      `PreviewPanel` fetches the file list. Both use the same `api()`
//      helper. The default mock returns empty results; tests that exercise
//      file-fetching override it on a per-test basis.
//
//   3. `@/lib/claude-complete` — exercised by the `CLAUDE_COMPLETE` bridge
//      route. Default mock resolves with a constant string so the path runs
//      end-to-end without hitting OpenRouter.
//
//   4. `html-to-image` — the Draw send path screenshots the iframe DOM via
//      `toPng`. Default mock returns a tiny stub data URL.
//
// `Element.prototype.scrollIntoView` is also missing from jsdom — see the
// scrollIntoView spy installed inside `installPreviewTestEnv()` below.

import { forwardRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ThemeProvider } from 'styled-components';
import { cleanup, render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import type { IframeToParent } from '@open-design/iframe-runtime';

import { theme } from '@/theme/theme';
import { WorkspaceProvider, useWorkspace } from '@/state/workspace';
import type { WorkspaceAction } from '@/state/types';
import { _resetProjectFilesCache } from '@/state/use-project-files';

// ───────── PreviewIframe stub ─────────
//
// State lives in module scope so the stub component can populate it from
// inside its useEffect, and the test body can read it back. We use refs so
// re-mounts inside a single test (rare) replace the captured iframe rather
// than appending — there is only ever one "current" iframe stub at a time.

interface StubBridgeRefs {
  iframe: HTMLIFrameElement | null;
  postMessageSpy: ReturnType<typeof vi.fn>;
  /** Resolves once `onMessageReady` has been invoked. */
  ready: Promise<void>;
}

const stubRefs: StubBridgeRefs = {
  iframe: null,
  postMessageSpy: vi.fn(),
  ready: Promise.resolve(),
};

let resolveReady: (() => void) | null = null;

function freshReadyGate(): Promise<void> {
  return new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
}

/**
 * Reset stub state between tests. Call from `beforeEach` in test files that
 * use `installPreviewTestEnv()`.
 */
export function resetPreviewStubState(): void {
  stubRefs.iframe?.remove();
  stubRefs.iframe = null;
  stubRefs.postMessageSpy = vi.fn();
  stubRefs.ready = freshReadyGate();
}

vi.mock('../PreviewIframe', () => ({
  // PreviewPanel passes a forwarded ref via `<PreviewIframe ref={iframeRef} />`,
  // so the stub must also accept refs to avoid the React warning.
  PreviewIframe: forwardRef<
    HTMLIFrameElement,
    {
      srcdoc: string;
      title?: string;
      onLoad?: () => void;
      onMessageReady?: (iframe: HTMLIFrameElement) => void;
    }
  >(function PreviewIframeStub({ onMessageReady }, forwardedRef) {
    useEffect(() => {
      const iframe = document.createElement('iframe');
      const spy = vi.fn();
      Object.defineProperty(iframe, 'contentWindow', {
        value: { postMessage: spy },
        configurable: true,
      });
      document.body.appendChild(iframe);
      stubRefs.iframe = iframe;
      stubRefs.postMessageSpy = spy;
      // Forward the ref so PreviewPanel can read iframe.contentDocument for
      // Draw screenshots (it uses iframeRef.current?.contentDocument?.body).
      if (typeof forwardedRef === 'function') forwardedRef(iframe);
      else if (forwardedRef) forwardedRef.current = iframe;
      onMessageReady?.(iframe);
      // Bridge is now wired; let any awaiting test continue.
      resolveReady?.();
      resolveReady = null;
      return () => {
        // Restore so jsdom's frame teardown doesn't crash trying to `.close()`
        // our plain-object contentWindow.
        Reflect.deleteProperty(iframe, 'contentWindow');
        iframe.remove();
        if (stubRefs.iframe === iframe) stubRefs.iframe = null;
      };
    }, [onMessageReady, forwardedRef]);
    return null;
  }),
}));

// Auto-unmount React trees between tests so the stub iframe's useEffect
// cleanup runs and jsdom's window teardown doesn't try to `.close()` the
// plain-object stub contentWindow.
afterEach(() => {
  cleanup();
});

/** Get the current stub iframe; throws if PreviewPanel hasn't mounted yet. */
export function getStubIframe(): HTMLIFrameElement {
  if (!stubRefs.iframe) {
    throw new Error('Stub iframe not ready — render PreviewPanel first then await waitForBridge()');
  }
  return stubRefs.iframe;
}

/** Get the spy that captures every `iframe.contentWindow.postMessage` call. */
export function getPostMessageSpy(): ReturnType<typeof vi.fn> {
  return stubRefs.postMessageSpy;
}

/** Resolve once PreviewPanel's `handleIframeReady` callback has fired. */
export function waitForBridge(): Promise<void> {
  return stubRefs.ready;
}

/**
 * Dispatch a window `message` event whose `source` matches the stub
 * iframe's contentWindow, so IframeBridge accepts it.
 */
export function emitFromIframe(msg: IframeToParent): void {
  const iframe = getStubIframe();
  const event = new MessageEvent('message', {
    data: msg,
    source: iframe.contentWindow as unknown as Window,
  });
  window.dispatchEvent(event);
}

/** Filter `postMessage` calls by message `type`, returning the data payloads. */
export function postedMessages<T extends Record<string, unknown>>(type: string): T[] {
  return getPostMessageSpy()
    .mock.calls.map(([msg]) => msg as T)
    .filter((m) => (m as { type?: string }).type === type);
}

// ───────── api / claudeComplete / html-to-image mocks ─────────

vi.mock('@/lib/api', () => ({
  api: vi.fn(async (path: string, init?: { method?: string }) => {
    // Defaults — tests can override via `apiMock.mockImplementationOnce` etc.
    if (path.endsWith('/comments') && (init?.method ?? 'GET') === 'GET') {
      return { comments: [] };
    }
    if (path.match(/\/files$/) && (init?.method ?? 'GET') === 'GET') {
      return { files: [] };
    }
    return undefined;
  }),
  ApiError: class ApiError extends Error {
    public readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

vi.mock('@/lib/claude-complete', () => ({
  claudeComplete: vi.fn(async () => 'mock-completion'),
}));

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async () => 'data:image/png;base64,STUB'),
}));

// ───────── Provider wrapper ─────────

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  projectId?: string;
  readOnly?: boolean;
  /**
   * Mount `<WorkspaceCapture/>` alongside `ui` so tests can drive workspace
   * state via `getWorkspace().dispatch(...)`. Default true for PreviewPanel
   * tests; set false for isolated renders that only assert on the DOM.
   */
  withWorkspaceCapture?: boolean;
}

export function renderWithProviders(
  ui: ReactNode,
  {
    projectId = 'test-project',
    readOnly = false,
    withWorkspaceCapture = true,
    ...rest
  }: RenderWithProvidersOptions = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return (
      <ThemeProvider theme={theme}>
        <WorkspaceProvider projectId={projectId} readOnly={readOnly}>
          {children}
          {withWorkspaceCapture ? <WorkspaceCapture /> : null}
        </WorkspaceProvider>
      </ThemeProvider>
    );
  }
  return render(<>{ui}</>, { wrapper: Wrapper, ...rest });
}

// ───────── workspace capture ─────────
//
// PreviewPanel reads everything from useWorkspace(); to drive it from a test
// we mount a sibling that captures the context value into a module-scope
// ref. Tests can then `act(() => workspaceRef.dispatch(...))` to push state
// changes through the same code path the rest of the app uses.

interface WorkspaceHandle {
  state: ReturnType<typeof useWorkspace>['state'];
  dispatch: (action: WorkspaceAction) => void;
  actions: ReturnType<typeof useWorkspace>['actions'];
}

const workspaceHandleRef: { current: WorkspaceHandle | null } = { current: null };

function WorkspaceCapture(): null {
  const ws = useWorkspace();
  workspaceHandleRef.current = ws;
  return null;
}

/** Get the workspace context captured by `<WorkspaceCapture/>`. */
export function getWorkspace(): WorkspaceHandle {
  if (!workspaceHandleRef.current) {
    throw new Error(
      'Workspace not captured — pass `withWorkspaceCapture: true` to renderWithProviders',
    );
  }
  return workspaceHandleRef.current;
}

/** Reset captured workspace state between tests. Also flushes the
 *  workspace-wide useProjectFiles cache so each test starts from a clean
 *  network mock (otherwise the second test with the same projectId hits a
 *  stale cache entry from the first test's fetch). */
export function resetWorkspaceCapture(): void {
  workspaceHandleRef.current = null;
  _resetProjectFilesCache();
}

// ───────── jsdom polyfill ─────────

/**
 * Install jsdom shims that PreviewPanel needs but jsdom 25 doesn't provide.
 * Call once per test file (e.g. inside `beforeAll`).
 *
 * - `Element.prototype.scrollIntoView` — used by the selectedPin scroll
 *   effect; assigning a `vi.fn()` lets us assert it was called.
 */
export function installPreviewTestEnv(): { scrollIntoView: ReturnType<typeof vi.fn> } {
  const scrollIntoView = vi.fn();
  // jsdom doesn't include scrollIntoView; assign on the prototype so every
  // element instance picks it up.
  Element.prototype.scrollIntoView = scrollIntoView;
  return { scrollIntoView };
}
