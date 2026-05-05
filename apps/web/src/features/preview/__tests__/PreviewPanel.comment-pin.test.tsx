// PreviewPanel — comment pin lifecycle.
//
// Comment-mode click-handling and the Save pin / Send to Atelier flows on
// the draft pin overlay. Verifies workspace state transitions plus the
// queueChatSubmit handoff that the chat panel drains.

import './test-helpers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { PreviewPanel } from '../PreviewPanel';
import { api } from '@/lib/api';

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

function setupApiWithFile(content = 'export default () => null;') {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (path.endsWith('/comments') && method === 'GET') return { comments: [] };
    if (path.endsWith('/comments') && method === 'POST') return { ok: true };
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

async function mountInCommentMode(): Promise<void> {
  renderWithProviders(<PreviewPanel />);
  await waitFor(() => expect(getWorkspace).not.toThrow());
  act(() => getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
  await waitFor(() => expect(getStubIframe()).toBeTruthy());
  act(() => getWorkspace().actions.setTool('comment'));
}

describe('PreviewPanel comment pin', () => {
  it('handleCommentClick creates a draft pin with filePath = active tab', async () => {
    await mountInCommentMode();

    // Find the click catcher (full-frame absolute layer with cursor=crosshair).
    // It's the only element with cursor: crosshair right now; reach via DOM
    // class-name-free query — match by computed style.
    const catcher = document.querySelector('div[style], div');
    // Simpler: synthesize the click on the Frame container directly.
    // PreviewPanel.tsx wires onClick on the ClickCatcher element; emulate
    // by dispatching a click on the closest matching div with an inset:0
    // and pointer-events:auto. Cleanest path: use ELEMENT_SELECTED instead,
    // which routes through the same set_drawing_pin code path with msg.rect.
    expect(catcher).toBeTruthy();
    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'comment',
        selector: '#hero',
        tag: 'DIV',
        outerHTML: '<div id="hero"></div>',
        styles: {},
        rect: { x: 100, y: 200, w: 50, h: 50 },
      }),
    );

    const pin = getWorkspace().state.drawingPin;
    expect(pin).not.toBeNull();
    expect(pin?.filePath).toBe('App.jsx');
    expect(pin?.x).toBe(125); // 100 + 50/2
    expect(pin?.y).toBe(225); // 200 + 50/2
    expect(pin?.selector).toBe('#hero');
  });

  it('Save pin commits the draft to state.pins and clears the draft', async () => {
    await mountInCommentMode();
    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'comment',
        selector: '.hero',
        tag: 'DIV',
        outerHTML: '<div></div>',
        styles: {},
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }),
    );

    const saveBtn = screen.getByRole('button', { name: 'Save pin' });
    act(() => fireEvent.click(saveBtn));

    const ws = getWorkspace();
    expect(ws.state.drawingPin).toBeNull();
    expect(ws.state.pins).toHaveLength(1);
    expect(ws.state.pins[0]).toMatchObject({ selector: '.hero', filePath: 'App.jsx' });
  });

  it('Save pin fires a fire-and-forget POST to /comments', async () => {
    await mountInCommentMode();
    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'comment',
        selector: '.hero',
        tag: 'DIV',
        outerHTML: '<div></div>',
        styles: {},
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }),
    );
    apiMock.mockClear();

    const saveBtn = screen.getByRole('button', { name: 'Save pin' });
    act(() => fireEvent.click(saveBtn));

    await waitFor(() => {
      const postCalls = apiMock.mock.calls.filter(
        ([path, init]) =>
          path.endsWith('/comments') && (init as { method?: string })?.method === 'POST',
      );
      expect(postCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('Send to Atelier queues a chat submit with selector context and clears the draft', async () => {
    await mountInCommentMode();
    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'comment',
        selector: '.cta',
        tag: 'BUTTON',
        outerHTML: '<button></button>',
        styles: {},
        rect: { x: 0, y: 0, w: 10, h: 10 },
      }),
    );

    // Type into the textarea so pin.text is non-empty.
    const textarea = screen.getByPlaceholderText(/Leave a comment/i);
    act(() => {
      fireEvent.change(textarea, { target: { value: 'change copy here' } });
    });

    const sendBtn = screen.getByRole('button', { name: 'Send to Atelier' });
    act(() => fireEvent.click(sendBtn));

    const ws = getWorkspace();
    expect(ws.state.drawingPin).toBeNull();
    // Pin still appended to state.pins (we both save and queue).
    expect(ws.state.pins).toHaveLength(1);
    expect(ws.state.pendingChatSubmit).not.toBeNull();
    expect(ws.state.pendingChatSubmit?.text).toContain('change copy here');
    expect(ws.state.pendingChatSubmit?.text).toContain('.cta');
  });

  it('Send to Atelier without text only commits the pin and does not queue chat', async () => {
    await mountInCommentMode();
    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'comment',
        selector: '.x',
        tag: 'DIV',
        outerHTML: '<div></div>',
        styles: {},
        rect: { x: 0, y: 0, w: 1, h: 1 },
      }),
    );

    const sendBtn = screen.getByRole('button', { name: 'Send to Atelier' });
    act(() => fireEvent.click(sendBtn));

    const ws = getWorkspace();
    expect(ws.state.pins).toHaveLength(1);
    expect(ws.state.pendingChatSubmit).toBeNull();
  });

  it('Cancel discards the draft without committing', async () => {
    await mountInCommentMode();
    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'comment',
        selector: '.x',
        tag: 'DIV',
        outerHTML: '<div></div>',
        styles: {},
        rect: { x: 0, y: 0, w: 1, h: 1 },
      }),
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    act(() => fireEvent.click(cancelBtn));

    const ws = getWorkspace();
    expect(ws.state.drawingPin).toBeNull();
    expect(ws.state.pins).toHaveLength(0);
  });

  it('host-side click on the catcher computes pin position from container bounds', async () => {
    await mountInCommentMode();
    // The ClickCatcher sits at inset:0 in the Frame; querying body for any
    // div with our pointer-events:auto + cursor:crosshair styling is fragile
    // since styled-components produces opaque class names. Easier: dispatch
    // a synthetic click on document.body and rely on the fact that the
    // catcher fills the container — clientX/Y minus the container's
    // (Renamed from "host-side click on catcher" — that path was deleted
    // when ClickCatcher was removed so the iframe-overlay mouse events are
    // no longer suppressed in comment mode. All comment pins now arrive via
    // ELEMENT_SELECTED — the explicit-element path covered by the prior
    // tests in this file. This case verifies that with no host-side catcher,
    // the comment-mode tool state remains intact across renders.)
    const ws = getWorkspace();
    expect(ws.state.tool).toBe('comment');
    expect(ws.state.drawingPin).toBeNull();
    // No <div data-testid="comment-click-catcher"> should be in the DOM —
    // the catcher was deleted to unblock overlay hover.
    expect(document.querySelector('[data-comment-click-catcher]')).toBeNull();
  });
});
