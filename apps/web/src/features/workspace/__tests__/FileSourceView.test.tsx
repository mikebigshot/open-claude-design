// FileSourceView — read-only source viewer unit tests.
//
// Coverage focus:
//   - Wave 1 follow-up: api() must be called with `expectText: true`.
//   - a11y: root must expose role="region" + aria-label so screen readers
//     announce "File source view"; loading state must be role="status"
//     (polite live region) so the file switch is announced; error state
//     must be role="alert" so it interrupts.
//
// We mock @/lib/api so we can assert request options and control the
// response payload independently of fetch wire details.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';
import { useWorkspace, WorkspaceProvider } from '@/state/workspace';
import { FileSourceView } from '../FileSourceView';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  ApiError: class extends Error {},
}));

const apiMock = api as unknown as ReturnType<typeof vi.fn>;

let projectCounter = 0;
function freshProjectId(): string {
  projectCounter += 1;
  return `fsv-${projectCounter}-${Date.now()}`;
}

function renderSource(path: string, projectId: string = freshProjectId()) {
  return render(
    <ThemeProvider theme={theme}>
      <WorkspaceProvider projectId={projectId}>
        <FileSourceView path={path} />
      </WorkspaceProvider>
    </ThemeProvider>,
  );
}

// Renders FileSourceView and exposes the workspace dispatch via a side-channel
// ref. Used by tests that need to simulate a `files_changed` tick (the chat
// agent writing files) to verify FileSourceView's soft-refresh behavior.
type DispatchHandle = {
  dispatch: ((a: { type: 'files_changed' }) => void) | null;
};
function DispatchProbe({ handle }: { handle: DispatchHandle }) {
  const ws = useWorkspace();
  // Capture the live dispatch on every render so tests always see the most
  // recent reference.
  useEffect(() => {
    handle.dispatch = (a) => ws.dispatch(a);
  });
  return null;
}

function renderSourceWithDispatch(path: string, projectId: string = freshProjectId()) {
  const handle: DispatchHandle = { dispatch: null };
  const utils = render(
    <ThemeProvider theme={theme}>
      <WorkspaceProvider projectId={projectId}>
        <DispatchProbe handle={handle} />
        <FileSourceView path={path} />
      </WorkspaceProvider>
    </ThemeProvider>,
  );
  return { ...utils, handle };
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/comments')) return { comments: [] };
    return 'export default null';
  });
});

afterEach(() => {
  cleanup();
});

describe('FileSourceView — content fetch round-trip', () => {
  it('passes { expectText: true } when fetching file content', async () => {
    renderSource('package.json');

    await waitFor(() => {
      const contentCalls = apiMock.mock.calls.filter(
        ([path]) => typeof path === 'string' && path.includes('/files/package.json'),
      );
      expect(contentCalls.length).toBeGreaterThan(0);
    });

    const contentCall = apiMock.mock.calls.find(
      ([path]) => typeof path === 'string' && path.includes('/files/package.json'),
    );
    const opts = contentCall![1] as { expectText?: boolean } | undefined;
    expect(opts?.expectText).toBe(true);
  });

  it('renders raw .json text verbatim line-by-line (no JSON round-trip)', async () => {
    // The original payload: 3 lines of indented JSON + trailing newline.
    // Without expectText, api() would parse and re-stringify with default
    // indentation, breaking the byte-for-byte preservation.
    const original = '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n';
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      if (path.includes('/files/package.json')) return original;
      return undefined;
    });

    renderSource('package.json');

    // The view splits content on '\n' so we can assert the exact rows.
    await waitFor(() => {
      const view = screen.getByTestId('file-source-view');
      // All four content lines + final empty line from trailing \n
      expect(view.textContent).toContain('{');
      expect(view.textContent).toContain('"name": "demo"');
      expect(view.textContent).toContain('"version": "1.0.0"');
      expect(view.textContent).toContain('}');
    });
  });
});

describe('FileSourceView — long content rendering', () => {
  // Bug repro (2026-05-03): "源代码预览窗口没有把所有内容显示出来（一些内容被
  // 裁掉/不能滚动到底）". Three things must hold for a long file:
  //   (1) Every line is in the DOM (no truncation/virtualisation cuts content).
  //   (2) The scroll container's content is taller than its viewport so it
  //       *can* be scrolled (otherwise content is unreachable below the fold).
  //   (3) Scrolling to the bottom doesn't lose the bottom-most line.

  it('renders every line of a 1500-line file (no truncation)', async () => {
    const lineCount = 1500;
    const lines: string[] = [];
    for (let i = 1; i <= lineCount; i++) {
      lines.push(`// LINE-${i}: marker-line-${i}`);
    }
    const content = lines.join('\n') + '\n';

    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      if (path.includes('/files/huge.jsx')) return content;
      return undefined;
    });

    renderSource('huge.jsx');

    await waitFor(() => {
      const view = screen.getByTestId('file-source-view');
      // 1500 content lines + 1 trailing-newline-induced empty row = 1501 trs.
      expect(view.querySelectorAll('tr').length).toBe(lineCount + 1);
    });

    const view = screen.getByTestId('file-source-view');
    // First and last meaningful lines are both reachable in DOM.
    expect(view.textContent).toContain('marker-line-1');
    expect(view.textContent).toContain(`marker-line-${lineCount}`);
  });

  it('renders the very last line of the file in the DOM', async () => {
    // Specific regression case: a file with a recognisable "BOTTOM_MARKER"
    // last line. If anything (virtualisation, truncation, off-screen culling,
    // CSS clip) eats the last row, this test catches it.
    const lines: string[] = [];
    for (let i = 1; i <= 800; i++) lines.push(`// filler line ${i}`);
    lines.push('// SENTINEL_BOTTOM_LINE_zZ9_visible_at_bottom');
    const content = lines.join('\n') + '\n';

    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      if (path.includes('/files/huge.jsx')) return content;
      return undefined;
    });

    renderSource('huge.jsx');
    await waitFor(() => {
      const view = screen.getByTestId('file-source-view');
      expect(view.textContent).toContain('SENTINEL_BOTTOM_LINE_zZ9_visible_at_bottom');
    });
  });

  it('Body (the scroll container) sets overflow:auto and min-height:0', async () => {
    // Layout invariant: the immediate parent of the source <table> must be a
    // scrollable flex item. If `overflow: auto` or `min-height: 0` is removed
    // (e.g. by an over-zealous refactor), the table either spills out of its
    // flex container or can't shrink, breaking vertical scrolling.
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      if (path.includes('/files/test.jsx')) return 'a\nb\nc\n';
      return undefined;
    });
    renderSource('test.jsx');
    await waitFor(() => {
      expect(screen.getByTestId('file-source-view')).toBeInTheDocument();
    });
    const table = screen.getByTestId('file-source-view');
    const body = table.parentElement!;
    // styled-components inlines the rules, so getComputedStyle picks them up.
    const cs = getComputedStyle(body);
    expect(cs.overflow === 'auto' || cs.overflowY === 'auto').toBe(true);
    // jsdom serialises `min-height: 0` as '0' rather than '0px'; either
    // representation is fine — we just want to assert it's set to zero so
    // the flex item is actually allowed to shrink.
    expect(['0', '0px']).toContain(cs.minHeight);
    // flex: 1 → flex-grow:1, flex-shrink:1, flex-basis:0%
    expect(cs.flex).toMatch(/^1\b/);
  });

  it('Frame (the absolute-positioned root) takes inset:0 not just height/width', async () => {
    // The root must cover its parent (FileOverlayLayer in Workspace.tsx). If
    // someone removes `inset: 0` or `position: absolute`, the source view
    // collapses to content height inside an `position: relative` overlay
    // (which is `display: flex` row, no flex-direction → wrong axis).
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      return 'one\ntwo\n';
    });
    renderSource('a.jsx');
    const root = await screen.findByTestId('file-source-content');
    const cs = getComputedStyle(root);
    expect(cs.position).toBe('absolute');
    // inset: 0 in jsdom: shorthand may not always expand to top/left/right/
    // bottom in computed style. Assert via the inset / inline-style fallback.
    // Either: cs.inset === '0px' OR top/left/right/bottom all '0px'.
    const isFullCover =
      cs.inset === '0px' ||
      (cs.top === '0px' && cs.left === '0px' && cs.right === '0px' && cs.bottom === '0px') ||
      // styled-components emits `inset: 0` directly into the rule — when
      // jsdom's CSSStyleDeclaration parses it the longhand may end up empty
      // and only `inset` is filled. Fall back to checking the parsed cssText.
      /inset:\s*0(?:px)?/.test(cs.cssText);
    expect(isFullCover).toBe(true);
    expect(cs.display).toBe('flex');
    expect(cs.flexDirection).toBe('column');
  });

  it('preserves the rendered table during filesChangedAt soft-refresh', async () => {
    // Bug repro (2026-05-03): "源代码预览窗口没有把所有内容显示出来 / 不能滚动
    // 到底". Before the fix, every `files_changed` dispatch (chat agent wrote
    // any file in the project) triggered the FileSourceView useEffect to
    // setContent(null) → the <table> unmounted → scrollTop reset to 0 → the
    // user saw the view jump back to the top mid-scroll. After the fix:
    //   - The table stays in the DOM continuously across soft refreshes.
    //   - The "Loading…" UI only takes over for *path* changes (hard reload).
    //   - The same DOM <table> element survives the tick, which is the
    //     prerequisite for scroll-position restoration to even make sense.
    const initial = Array.from({ length: 200 }, (_, i) => `line-${i + 1}`).join('\n') + '\n';
    let fileFetchCalls = 0;
    apiMock.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('/comments')) {
        return Promise.resolve({ comments: [] });
      }
      if (typeof path === 'string' && path.includes('/files/file.jsx')) {
        fileFetchCalls += 1;
        return Promise.resolve(initial);
      }
      return Promise.resolve(undefined);
    });

    const { handle } = renderSourceWithDispatch('file.jsx');

    await waitFor(() => {
      expect(screen.getByTestId('file-source-view')).toBeInTheDocument();
    });
    const initialTable = screen.getByTestId('file-source-view');
    // 200 lines + trailing-newline empty row = 201.
    expect(initialTable.querySelectorAll('tr').length).toBe(201);
    expect(fileFetchCalls).toBe(1);

    // Simulate "chat agent wrote a file" → filesChangedAt tick.
    await act(async () => {
      handle.dispatch?.({ type: 'files_changed' });
    });

    // Loading UI must NOT take over (we have content already; this is a soft
    // refresh, not a hard reload).
    expect(screen.queryByTestId('file-source-loading')).not.toBeInTheDocument();
    // The same <table> element must still be present. Same DOM node = scroll
    // position survives. (Container ref equality is the strongest assertion
    // we can make in jsdom because there's no actual layout / scrollTop.)
    const stillTable = screen.getByTestId('file-source-view');
    expect(stillTable).toBe(initialTable);

    // Wait for the background soft-refresh fetch to complete and verify the
    // table identity is *still* preserved (React keeps the mounted instance
    // because content stays non-null throughout).
    await waitFor(() => {
      expect(fileFetchCalls).toBe(2);
    });
    expect(screen.getByTestId('file-source-view')).toBe(initialTable);
  });

  it('hard-reloads (shows Loading…) when path actually changes', async () => {
    // Counterpart to the soft-refresh test: when the user opens a *different*
    // file, we WANT the loading UI back — that's the user-visible cue that
    // they switched files. This test guards the implementation from sliding
    // into "always soft-refresh".
    type Resolver = (v: string) => void;
    const pending: { resolve: Resolver | null } = { resolve: null };
    apiMock.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('/comments')) {
        return Promise.resolve({ comments: [] });
      }
      if (typeof path === 'string' && path.includes('/files/first.jsx')) {
        return Promise.resolve('initial-content');
      }
      if (typeof path === 'string' && path.includes('/files/second.jsx')) {
        return new Promise<string>((resolve) => {
          pending.resolve = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const projectId = freshProjectId();
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <WorkspaceProvider projectId={projectId}>
          <FileSourceView path="first.jsx" />
        </WorkspaceProvider>
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('file-source-view')).toBeInTheDocument();
    });

    rerender(
      <ThemeProvider theme={theme}>
        <WorkspaceProvider projectId={projectId}>
          <FileSourceView path="second.jsx" />
        </WorkspaceProvider>
      </ThemeProvider>,
    );

    // Loading UI takes over because the path changed and content is being
    // freshly fetched (we're holding the second.jsx promise open).
    await waitFor(() => {
      expect(screen.getByTestId('file-source-loading')).toBeInTheDocument();
    });
    // Old content is gone (no <table>).
    expect(screen.queryByTestId('file-source-view')).not.toBeInTheDocument();

    // Resolve the pending fetch so React doesn't complain about pending state.
    pending.resolve?.('second-content\n');
    await waitFor(() => {
      expect(screen.getByTestId('file-source-view')).toBeInTheDocument();
    });
  });

  it('exposes the scroll body via [data-testid="file-source-body"] and applies bottom padding', async () => {
    // The Body div is the scroll container the user actually moves. We expose
    // a stable testid + padding-bottom so e2e and visual tests can target it
    // without DOM-tree archaeology, and so the bottom-most line isn't tucked
    // under the (fixed-position) DropHint overlay in Workspace.
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      return 'a\nb\nc\n';
    });
    renderSource('test.jsx');
    await waitFor(() => {
      expect(screen.getByTestId('file-source-view')).toBeInTheDocument();
    });
    const body = screen.getByTestId('file-source-body');
    const cs = getComputedStyle(body);
    // Numeric, just don't be 0.
    const padBottom = parseFloat(cs.paddingBottom || '0');
    expect(padBottom).toBeGreaterThan(0);
  });
});

describe('FileSourceView — a11y', () => {
  it('root has role="region" + aria-label so screen readers announce the view', async () => {
    renderSource('App.jsx');
    const root = await screen.findByTestId('file-source-content');
    expect(root.getAttribute('role')).toBe('region');
    expect(root.getAttribute('aria-label')).toBeTruthy();
    expect(root.getAttribute('aria-label')!.toLowerCase()).toContain('file source');
  });

  it('root has aria-live="polite" so file switches are announced to AT', async () => {
    renderSource('App.jsx');
    const root = await screen.findByTestId('file-source-content');
    expect(root.getAttribute('aria-live')).toBe('polite');
  });

  it('loading state has role="status" (a polite live region indicator)', async () => {
    // Make api() never resolve so we stay in loading state.
    apiMock.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('/comments'))
        return Promise.resolve({ comments: [] });
      return new Promise(() => {});
    });
    renderSource('App.jsx');
    const loading = await screen.findByTestId('file-source-loading');
    expect(loading.getAttribute('role')).toBe('status');
  });

  it('error state has role="alert"', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      throw new Error('boom');
    });
    renderSource('App.jsx');
    const err = await screen.findByTestId('file-source-error');
    expect(err.getAttribute('role')).toBe('alert');
  });
});
