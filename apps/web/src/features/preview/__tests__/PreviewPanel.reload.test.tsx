// PreviewPanel — `state.filesChangedAt` must trigger a re-fetch + iframe remount.
//
// Bug context: the toolbar Reload button bumps filesChangedAt, but if
// PreviewPanel didn't actually re-fetch the file list (or didn't remount the
// iframe with new srcdoc), the user-visible result would be "click did
// nothing". This test pins the contract.
//
// We assert two things:
//   1. The /files GET fires again on filesChangedAt change.
//   2. The PreviewIframe stub gets a *new* iframe instance (key prop change
//      forces remount, which reset cached-root state inside the artifact).

import './test-helpers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { PreviewPanel } from '../PreviewPanel';
import { api } from '@/lib/api';

import {
  getStubIframe,
  getWorkspace,
  installPreviewTestEnv,
  renderWithProviders,
  resetPreviewStubState,
  resetWorkspaceCapture,
} from './test-helpers';

const apiMock = api as unknown as ReturnType<typeof vi.fn>;

function setupApiWithFile(content = 'export default () => null;') {
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
            size: content.length,
            mimeType: 'text/jsx',
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    }
    if (path.includes('/files/') && method === 'GET') return content;
    return undefined;
  });
}

function countFilesGets(): number {
  return apiMock.mock.calls.filter(([path, init]) => {
    const method = (init as { method?: string } | undefined)?.method ?? 'GET';
    return path.match(/\/files$/) && method === 'GET';
  }).length;
}

beforeAll(() => {
  installPreviewTestEnv();
});

beforeEach(() => {
  resetPreviewStubState();
  resetWorkspaceCapture();
  apiMock.mockReset();
  setupApiWithFile();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountReady(): Promise<void> {
  renderWithProviders(<PreviewPanel />);
  await waitFor(() => expect(getWorkspace).not.toThrow());
  act(() => getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
  await waitFor(() => expect(getStubIframe()).toBeTruthy());
}

describe('PreviewPanel — filesChangedAt → re-fetch + iframe remount', () => {
  it('refetches /files when filesChangedAt is bumped', async () => {
    await mountReady();
    // Wait for the initial fetch to settle then count.
    await waitFor(() => expect(countFilesGets()).toBeGreaterThanOrEqual(1));
    const initialGetCount = countFilesGets();

    act(() => getWorkspace().dispatch({ type: 'files_changed' }));

    await waitFor(() => expect(countFilesGets()).toBeGreaterThan(initialGetCount));
  });

  it('PreviewPanel remounts the iframe (new instance) on files_changed', async () => {
    await mountReady();
    const firstIframe = getStubIframe();

    // Simulate the agent finishing a write: workspace dispatches files_changed
    // (in the real app: ChatPanel's tool-call effect or the Reload button).
    act(() => getWorkspace().dispatch({ type: 'files_changed' }));

    // Wait until a *different* iframe element is captured by the stub.
    // The PreviewPanel must pass `key={state.filesChangedAt}` to PreviewIframe
    // so React unmounts/remounts on every bump → cached-root state resets.
    await waitFor(() => {
      const next = getStubIframe();
      expect(next).not.toBe(firstIframe);
    });
  });
});
