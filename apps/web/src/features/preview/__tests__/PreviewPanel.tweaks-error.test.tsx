// PreviewPanel — P1-8: Tweaks PUT failure must surface a toast.
//
// Before the fix, `bridge.on('__edit_mode_set_keys')` ran persistEditModeKeys
// inside a `.catch(() => {})` swallow. When the PUT failed (404 / 500 / network
// blip) the artifact's iframe state had already moved on (artifact owns the
// React state), but our source-of-truth file on disk stayed stale — and the
// user got NO signal. This test pins the new contract: a toast appears.

import './test-helpers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import { PreviewPanel } from '../PreviewPanel';
import { api } from '@/lib/api';
import { ToastHost, resetToastsForTest } from '@/components/Toast';

import {
  emitFromIframe,
  getStubIframe,
  getWorkspace,
  installPreviewTestEnv,
  renderWithProviders,
  resetPreviewStubState,
  resetWorkspaceCapture,
} from './test-helpers';

const apiMock = api as unknown as ReturnType<typeof vi.fn>;

const SOURCE_WITH_BLOCK =
  'export default function App() {\n  /*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/\n  return null;\n}';

function setupApi(opts: { putRejects?: boolean }) {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (path.endsWith('/comments') && method === 'GET') return { comments: [] };
    if (path.match(/\/files$/) && method === 'GET') {
      return {
        files: [
          {
            projectId: 'test-project',
            path: 'App.jsx',
            sha256: 'aa',
            size: SOURCE_WITH_BLOCK.length,
            mimeType: 'text/jsx',
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    }
    if (path.includes('/files/') && method === 'GET') return SOURCE_WITH_BLOCK;
    if (path.includes('/files/') && method === 'PUT') {
      if (opts.putRejects) {
        throw new Error('HTTP 500 Internal Server Error');
      }
      return undefined;
    }
    return undefined;
  });
}

beforeAll(() => {
  installPreviewTestEnv();
});

beforeEach(() => {
  resetPreviewStubState();
  resetWorkspaceCapture();
  resetToastsForTest();
  apiMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountReady(): Promise<void> {
  // Render PreviewPanel + a sibling ToastHost so we can assert the toast.
  // resetWorkspaceCapture is already called in beforeEach.
  renderWithProviders(
    <>
      <PreviewPanel />
      {/* Mounting ToastHost inside the same ThemeProvider sandbox via
          renderWithProviders's outer ThemeProvider (it already wraps). */}
      <ToastHost />
    </>,
  );
  await waitFor(() => expect(getWorkspace).not.toThrow());
  act(() => {
    getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' });
  });
  await waitFor(() => expect(getStubIframe()).toBeTruthy());
}

describe('PreviewPanel — Tweaks PUT failure (P1-8)', () => {
  it('shows an error toast when the EDITMODE PUT rejects', async () => {
    setupApi({ putRejects: true });
    await mountReady();

    // Drive a tweak postMessage from the iframe.
    act(() =>
      emitFromIframe({
        type: '__edit_mode_set_keys',
        edits: { a: 2 },
      }),
    );

    // Toast appears and announces the failure.
    await waitFor(() => {
      expect(screen.getByTestId('toast')).toBeInTheDocument();
    });
    const toast = screen.getByTestId('toast');
    expect(toast).toHaveAttribute('role', 'alert');
    expect(toast.textContent).toMatch(/save tweak|unsaved/i);
  });

  it('does NOT show a toast when the PUT succeeds', async () => {
    setupApi({ putRejects: false });
    await mountReady();

    act(() =>
      emitFromIframe({
        type: '__edit_mode_set_keys',
        edits: { a: 3 },
      }),
    );

    // Wait long enough for the PUT promise chain to settle.
    await waitFor(() => {
      const putCalls = apiMock.mock.calls.filter(
        ([, init]) => (init as { method?: string } | undefined)?.method === 'PUT',
      );
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
    });
    // Settle microtasks for the catch path that should NOT fire.
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('repeated drag failures collapse into a single toast (stable id)', async () => {
    setupApi({ putRejects: true });
    await mountReady();

    // Drive 3 quick edits — each PUT fails. With a stable toast id, only
    // one toast should be visible at a time (replacing).
    act(() => emitFromIframe({ type: '__edit_mode_set_keys', edits: { a: 2 } }));
    act(() => emitFromIframe({ type: '__edit_mode_set_keys', edits: { a: 3 } }));
    act(() => emitFromIframe({ type: '__edit_mode_set_keys', edits: { a: 4 } }));

    await waitFor(() => {
      expect(screen.getByTestId('toast')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
  });
});
