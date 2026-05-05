// PreviewPanel — selectedPinId scroll-into-view effect.
//
// CommentsTab dispatches `set_selected_pin` with a pin id; PreviewPanel
// queries `[data-pin-id="..."]`, scrolls it into view, briefly outlines it
// in brand orange, then after 1500ms clears the outline and dispatches
// set_selected_pin: null so a re-click on the same pin re-fires the effect.

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

let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

beforeAll(() => {
  ({ scrollIntoView: scrollIntoViewSpy } = installPreviewTestEnv());
});

beforeEach(() => {
  resetPreviewStubState();
  resetWorkspaceCapture();
  apiMock.mockReset();
  scrollIntoViewSpy.mockClear();
  setupApiWithFile();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountWithPin(pinId: string): Promise<void> {
  renderWithProviders(<PreviewPanel />);
  await waitFor(() => expect(getWorkspace).not.toThrow());
  act(() => getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
  await waitFor(() => expect(getStubIframe()).toBeTruthy());
  // Add a pin so [data-pin-id="..."] exists in the rendered overlay.
  act(() => {
    getWorkspace().dispatch({
      type: 'set_pins',
      pins: [
        {
          id: pinId,
          n: 1,
          x: 100,
          y: 100,
          text: 'pin',
          selector: null,
          filePath: 'App.jsx',
          createdAt: new Date().toISOString(),
        },
      ],
    });
  });
  // 产品行为更新（用户需求 b, 2026-05-03）: 非 Comment 工具激活时，CommentPinOverlay
  // 仅渲染 state.selectedPinId 对应的 pin。所以 mount 时 pin DOM 不存在 ——
  // 测试用例自己 dispatch set_selected_pin 后再 query DOM。
}

describe('PreviewPanel selectedPinId scroll', () => {
  it('does nothing when selectedPinId is null', async () => {
    await mountWithPin('pin-1');
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('scrolls the pin into view when selectedPinId matches a rendered pin', async () => {
    await mountWithPin('pin-1');

    act(() => getWorkspace().dispatch({ type: 'set_selected_pin', id: 'pin-1' }));

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('applies an outline ring + offset on the pin DOM node', async () => {
    await mountWithPin('pin-1');

    act(() => getWorkspace().dispatch({ type: 'set_selected_pin', id: 'pin-1' }));

    const node = document.querySelector<HTMLElement>('[data-pin-id="pin-1"]')!;
    expect(node.style.outline).toContain('#C96442');
    expect(node.style.outlineOffset).toBe('4px');
  });

  it('clears the outline + selectedPinId after 1500ms', async () => {
    await mountWithPin('pin-1');
    // Switch to fake timers AFTER mountWithPin completes — testing-library's
    // waitFor uses setInterval, which would never fire under fake timers.
    vi.useFakeTimers();

    act(() => getWorkspace().dispatch({ type: 'set_selected_pin', id: 'pin-1' }));
    const node = document.querySelector<HTMLElement>('[data-pin-id="pin-1"]')!;
    expect(node.style.outline).not.toBe('');

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(node.style.outline).toBe('');
    expect(node.style.outlineOffset).toBe('');
    expect(getWorkspace().state.selectedPinId).toBeNull();
  });

  it('does nothing if the pin id does not match any rendered node', async () => {
    await mountWithPin('pin-1');

    act(() => getWorkspace().dispatch({ type: 'set_selected_pin', id: 'pin-NOT-THERE' }));

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('handles pin ids with CSS-special characters via CSS.escape', async () => {
    await mountWithPin('pin:with:colons');

    act(() => getWorkspace().dispatch({ type: 'set_selected_pin', id: 'pin:with:colons' }));

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('cleanup function cancels the timer when selectedPinId changes mid-flight', async () => {
    await mountWithPin('pin-1');
    vi.useFakeTimers();
    act(() => {
      getWorkspace().dispatch({
        type: 'set_pins',
        pins: [
          ...getWorkspace().state.pins,
          {
            id: 'pin-2',
            n: 2,
            x: 200,
            y: 200,
            text: 'pin 2',
            selector: null,
            filePath: 'App.jsx',
            createdAt: new Date().toISOString(),
          },
        ],
      });
    });

    act(() => getWorkspace().dispatch({ type: 'set_selected_pin', id: 'pin-1' }));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Switch to a different pin before the 1500ms elapses.
    act(() => getWorkspace().dispatch({ type: 'set_selected_pin', id: 'pin-2' }));

    // The first timer should have been cancelled by the cleanup function;
    // pin-1's outline gets restored by the cleanup OR overridden by the new
    // effect. Either way, advancing time another 1000ms should NOT trigger
    // a stray clear of pin-2 (that would require 1500ms total from pin-2's
    // dispatch).
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getWorkspace().state.selectedPinId).toBe('pin-2');

    // After the full 1500ms from pin-2's dispatch, pin-2 should clear.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getWorkspace().state.selectedPinId).toBeNull();
  });
});
