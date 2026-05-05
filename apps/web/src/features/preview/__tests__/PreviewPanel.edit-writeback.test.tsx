// PreviewPanel — Edit-mode style accumulator + flush.
//
// Style edits land via two paths:
//   - bridge.send EDIT_STYLE forwards the change to the iframe overlay
//     immediately (so the user sees the result without a re-render round
//     trip).
//   - pendingEditsRef accumulates (selector → property → value) so that on
//     leaving Edit mode we PUT the merged inline style back into the source
//     file via persistEditStyles. Done in batch to keep typing-fast slider
//     drags from spamming PUTs.

import './test-helpers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { PreviewPanel } from '../PreviewPanel';
import { api } from '@/lib/api';
import { persistEditStyles } from '../persist-edit-styles';
import { ToastHost, resetToastsForTest } from '@/components/Toast';

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

vi.mock('../persist-edit-styles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persist-edit-styles')>();
  return {
    ...actual,
    persistEditStyles: vi.fn().mockResolvedValue({ written: 1, missed: 0 }),
  };
});

const apiMock = api as unknown as ReturnType<typeof vi.fn>;
const persistEditStylesMock = persistEditStyles as unknown as ReturnType<typeof vi.fn>;

function setupApiWithFile(content = 'export default () => <button>Hi</button>;') {
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
  resetToastsForTest();
  apiMock.mockReset();
  persistEditStylesMock.mockReset();
  persistEditStylesMock.mockResolvedValue({ written: 1, missed: 0 });
  setupApiWithFile();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountInEditMode(): Promise<void> {
  renderWithProviders(
    <>
      <PreviewPanel />
      <ToastHost />
    </>,
  );
  await waitFor(() => expect(getWorkspace).not.toThrow());
  act(() => getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
  await waitFor(() => expect(getStubIframe()).toBeTruthy());
  act(() => getWorkspace().actions.setTool('edit'));
}

function selectButton(): void {
  act(() =>
    emitFromIframe({
      type: 'ELEMENT_SELECTED',
      mode: 'edit',
      selector: 'button',
      tag: 'BUTTON',
      outerHTML: '<button>Hi</button>',
      styles: { 'background-color': 'rgb(255, 255, 255)' },
      rect: { x: 0, y: 0, w: 50, h: 20 },
    }),
  );
}

describe('PreviewPanel Edit write-back', () => {
  it('does not call persistEditStyles when leaving Edit with no pending edits', async () => {
    await mountInEditMode();
    selectButton();

    act(() => getWorkspace().actions.setTool(null));

    expect(persistEditStylesMock).not.toHaveBeenCalled();
  });

  it('forwards EDIT_STYLE to the iframe on every swatch click', async () => {
    await mountInEditMode();
    selectButton();
    getPostMessageSpy().mockClear();

    const swatch = screen.getByRole('button', { name: /Background #141413/i });
    act(() => {
      fireEvent.click(swatch);
    });

    const editStyles = postedMessages<{ property: string; value: string }>('EDIT_STYLE');
    expect(editStyles.length).toBeGreaterThanOrEqual(1);
    expect(editStyles.at(-1)).toMatchObject({
      property: 'background-color',
      value: '#141413',
    });
  });

  it('flushes accumulated style edits via persistEditStyles when leaving Edit mode', async () => {
    await mountInEditMode();
    selectButton();

    // Two off-palette swatches (#141413 and #F3E7DF) — both fall through the
    // css-to-tailwind mapping to inline-style write-back. (#FFFFFF maps to
    // bg-white and would route to the className path — covered separately.)
    const swatchDark = screen.getByRole('button', { name: /Background #141413/i });
    act(() => fireEvent.click(swatchDark));
    const swatchPeach = screen.getByRole('button', { name: /Background #F3E7DF/i });
    act(() => fireEvent.click(swatchPeach));

    act(() => getWorkspace().actions.setTool(null));

    await waitFor(() => expect(persistEditStylesMock).toHaveBeenCalledTimes(1));
    const [projectId, fileSnapshot, pending] = persistEditStylesMock.mock.calls[0]!;
    expect(projectId).toBe('test-project');
    expect(Array.isArray(fileSnapshot)).toBe(true);
    expect(fileSnapshot[0]).toMatchObject({ path: 'App.jsx' });
    // Pending is a Map<selector, PendingEditEntry>; later writes should win.
    const entry = (pending as Map<string, { styles: Record<string, string> }>).get('button');
    expect(entry?.styles['background-color']).toBe('#F3E7DF');
  });

  it('clears the pending map after flush so a second leave does not double-write', async () => {
    await mountInEditMode();
    selectButton();
    const swatch = screen.getByRole('button', { name: /Background #141413/i });
    act(() => fireEvent.click(swatch));

    act(() => getWorkspace().actions.setTool(null));
    await waitFor(() => expect(persistEditStylesMock).toHaveBeenCalledTimes(1));

    // Re-enter and re-leave Edit mode without any new edits.
    act(() => getWorkspace().actions.setTool('edit'));
    act(() => getWorkspace().actions.setTool(null));
    expect(persistEditStylesMock).toHaveBeenCalledTimes(1);
  });

  it('triggers files_changed dispatch when the flush reports written > 0', async () => {
    persistEditStylesMock.mockResolvedValue({ written: 2, missed: 0 });
    await mountInEditMode();
    selectButton();
    const swatch = screen.getByRole('button', { name: /Background #141413/i });
    act(() => fireEvent.click(swatch));

    const before = getWorkspace().state.filesChangedAt;
    act(() => getWorkspace().actions.setTool(null));

    await waitFor(() => {
      expect(getWorkspace().state.filesChangedAt).toBeGreaterThan(before);
    });
  });

  it('does not bump filesChangedAt when persistEditStyles reports written = 0', async () => {
    persistEditStylesMock.mockResolvedValue({ written: 0, missed: 1 });
    await mountInEditMode();
    selectButton();
    const swatch = screen.getByRole('button', { name: /Background #141413/i });
    act(() => fireEvent.click(swatch));

    const before = getWorkspace().state.filesChangedAt;
    act(() => getWorkspace().actions.setTool(null));

    await waitFor(() => expect(persistEditStylesMock).toHaveBeenCalled());
    // Give the .then callback a tick to settle.
    await Promise.resolve();
    expect(getWorkspace().state.filesChangedAt).toBe(before);
  });

  it('surfaces a toast when persistEditStyles reports missed > 0 (P2-12)', async () => {
    // Simulate the createElement-style miss case: persist couldn't find a match
    // in the source, written=0, missed=1. The optimistic UI already moved on,
    // so the user must see a toast or they'll lose the change silently.
    persistEditStylesMock.mockResolvedValue({ written: 0, missed: 1 });
    await mountInEditMode();
    selectButton();
    const swatch = screen.getByRole('button', { name: /Background #141413/i });
    act(() => fireEvent.click(swatch));

    act(() => getWorkspace().actions.setTool(null));
    await waitFor(() => expect(persistEditStylesMock).toHaveBeenCalled());

    await waitFor(() => {
      const toast = screen.queryByTestId('toast');
      expect(toast).not.toBeNull();
      expect(toast!.getAttribute('data-toast-variant')).toBe('error');
      expect(toast!.textContent ?? '').toMatch(/Couldn't save/i);
    });
  });

  it('routes to the className AST writer (not inline-style) when value maps to a Tailwind class', async () => {
    await mountInEditMode();
    selectButton();
    // #FFFFFF maps to bg-white via cssPropertyToTailwind → should NOT call
    // persistEditStyles. (This is the P2-8 routing behavior.)
    const swatch = screen.getByRole('button', { name: /Background #FFFFFF/i });
    act(() => fireEvent.click(swatch));

    act(() => getWorkspace().actions.setTool(null));
    // Wait for any pending microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(persistEditStylesMock).not.toHaveBeenCalled();
  });
});
