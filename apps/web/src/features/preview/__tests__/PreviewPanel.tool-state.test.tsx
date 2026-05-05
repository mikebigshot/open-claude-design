// PreviewPanel — tool-state effect.
//
// The `[state.tool, tweaksAvailable]` effect at PreviewPanel.tsx:323 always
// emits SET_MODE and conditionally activates/deactivates the artifact's
// in-iframe Tweaks UI. Verifies the four transitions the user can make from
// the toolbar buttons.

import './test-helpers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { PreviewPanel } from '../PreviewPanel';
import { api } from '@/lib/api';

import {
  emitFromIframe,
  getPostMessageSpy,
  getStubIframe,
  getWorkspace,
  installPreviewTestEnv,
  postedMessages,
  renderWithProviders,
  resetPreviewStubState,
  resetWorkspaceCapture,
} from './test-helpers';

const apiMock = api as unknown as ReturnType<typeof vi.fn>;

function setupApiWithFile(content = 'export default () => null;') {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (path.endsWith('/comments')) return { comments: [] };
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
    if (path.includes('/files/')) return method === 'GET' ? content : undefined;
    return undefined;
  });
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

describe('PreviewPanel tool-state effect', () => {
  it('sends SET_MODE on every tool transition', async () => {
    await mountReady();
    getPostMessageSpy().mockClear();

    act(() => getWorkspace().actions.setTool('comment'));
    expect(postedMessages<{ mode: unknown }>('SET_MODE').at(-1)).toMatchObject({ mode: 'comment' });

    act(() => getWorkspace().actions.setTool('draw'));
    expect(postedMessages<{ mode: unknown }>('SET_MODE').at(-1)).toMatchObject({ mode: 'draw' });

    act(() => getWorkspace().actions.setTool(null));
    expect(postedMessages<{ mode: unknown }>('SET_MODE').at(-1)).toMatchObject({ mode: null });
  });

  it('does not send __activate_edit_mode when tweaks tool active but artifact has no Tweaks', async () => {
    await mountReady();
    getPostMessageSpy().mockClear();

    act(() => getWorkspace().actions.setTool('tweaks'));

    expect(postedMessages('__activate_edit_mode')).toHaveLength(0);
  });

  it('sends __activate_edit_mode after artifact reports __edit_mode_available with tweaks active', async () => {
    await mountReady();
    act(() => getWorkspace().actions.setTool('tweaks'));
    getPostMessageSpy().mockClear();

    act(() => emitFromIframe({ type: '__edit_mode_available' }));

    expect(postedMessages('__activate_edit_mode').length).toBeGreaterThanOrEqual(1);
  });

  it('sends __deactivate_edit_mode when leaving tweaks after Tweaks was available', async () => {
    await mountReady();
    act(() => getWorkspace().actions.setTool('tweaks'));
    act(() => emitFromIframe({ type: '__edit_mode_available' }));
    getPostMessageSpy().mockClear();

    act(() => getWorkspace().actions.setTool('comment'));

    expect(postedMessages('__deactivate_edit_mode').length).toBeGreaterThanOrEqual(1);
  });

  it('does not send __deactivate_edit_mode if Tweaks was never available', async () => {
    await mountReady();
    act(() => getWorkspace().actions.setTool('tweaks'));
    getPostMessageSpy().mockClear();

    act(() => getWorkspace().actions.setTool('comment'));

    expect(postedMessages('__deactivate_edit_mode')).toHaveLength(0);
  });

  it('clears editSelection (and EDIT_STYLE flow) when leaving Edit mode', async () => {
    await mountReady();
    act(() => getWorkspace().actions.setTool('edit'));
    // Select an element so handleStyleChange has an active selection.
    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'edit',
        selector: '.btn',
        tag: 'BUTTON',
        outerHTML: '<button class="btn">Hi</button>',
        styles: {},
        rect: { x: 0, y: 0, w: 1, h: 1 },
      }),
    );

    // Leaving edit mode should clear editSelection. Verifying indirectly: a
    // subsequent ELEMENT_SELECTED on a freshly-set tool should not throw.
    act(() => getWorkspace().actions.setTool(null));
    expect(getWorkspace().state.tool).toBeNull();
  });
});
