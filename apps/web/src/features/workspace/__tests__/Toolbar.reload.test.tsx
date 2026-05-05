// Toolbar — Reload button must trigger a fresh file fetch + iframe remount.
//
// Bug context (2026-05-03 user report):
//   "agent 写完文件后预览没变，点工具栏 reload 按钮也无效，必须刷新整个浏览器"
//
// Root cause:
//   handleReload was calling iframe.contentWindow.location.reload() on a
//   srcdoc iframe. That re-parses the *current* srcdoc attribute (whose value
//   was set from STALE host-side files state), so the user sees the same old
//   bundle. PreviewPanel never re-fetches /api/projects/:id/files unless
//   `state.filesChangedAt` ticks — and the reload button wasn't bumping it.
//
// Fix:
//   handleReload dispatches `files_changed` so PreviewPanel's fetch effect
//   re-runs (`useEffect` keyed on filesChangedAt). The new files produce a
//   new srcdoc string, which React feeds into <iframe srcDoc>, which the
//   browser re-parses → fresh bundle → iframe remounts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { MemoryRouter } from 'react-router-dom';

import { theme } from '@/theme/theme';
import { Toolbar } from '../Toolbar';
import { WorkspaceProvider, useWorkspace } from '@/state/workspace';
import type { WorkspaceAction } from '@/state/types';

// Stub the api helper so WorkspaceProvider's pin-hydrate fetch doesn't blow up.
vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ comments: [] })),
  ApiError: class ApiError extends Error {
    public readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

// Capture-bridge so tests can read state / dispatch outside the React tree.
interface Handle {
  state: ReturnType<typeof useWorkspace>['state'];
  dispatch: (a: WorkspaceAction) => void;
  actions: ReturnType<typeof useWorkspace>['actions'];
}

const handleRef: { current: Handle | null } = { current: null };

function Capture(): null {
  const ws = useWorkspace();
  handleRef.current = ws;
  return null;
}

function mount(): void {
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <WorkspaceProvider projectId="test-proj">
          <Capture />
          <Toolbar />
        </WorkspaceProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  handleRef.current = null;
  cleanup();
});

beforeEach(() => {
  // Toolbar's tool-buttons + reload only render when activeTab !== Design Files.
});

describe('Toolbar Reload button', () => {
  it('bumps filesChangedAt so PreviewPanel re-fetches files', () => {
    mount();
    // Switch off the "Design Files" tab so the reload button renders.
    act(() => handleRef.current!.dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
    const before = handleRef.current!.state.filesChangedAt;

    const reloadBtn = screen.getByRole('button', { name: /^Reload$/i });
    act(() => fireEvent.click(reloadBtn));

    const after = handleRef.current!.state.filesChangedAt;
    // Strict inequality — the click MUST bump the timestamp, otherwise the
    // PreviewPanel useEffect (keyed on filesChangedAt) wouldn't re-run.
    expect(after).toBeGreaterThan(before);
  });

  it('does not crash when called twice rapidly (each click bumps timestamp)', () => {
    mount();
    act(() => handleRef.current!.dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
    const reloadBtn = screen.getByRole('button', { name: /^Reload$/i });

    act(() => fireEvent.click(reloadBtn));
    const t1 = handleRef.current!.state.filesChangedAt;
    // Force a 1ms gap so Date.now() actually advances on fast hosts.
    const realNow = Date.now;
    let n = realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => {
      n += 5;
      return n;
    });
    act(() => fireEvent.click(reloadBtn));
    const t2 = handleRef.current!.state.filesChangedAt;

    expect(t2).toBeGreaterThan(t1);
    vi.restoreAllMocks();
  });

  it('aria-label "Reload" is preserved (a11y)', () => {
    mount();
    act(() => handleRef.current!.dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
    const reloadBtn = screen.getByLabelText('Reload');
    expect(reloadBtn).toBeInTheDocument();
  });
});
