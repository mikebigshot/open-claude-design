// PreviewPanel — bridge message routing.
//
// Covers each `bridge.on(...)` handler installed inside `handleIframeReady`:
// OVERLAY_READY echoes SET_MODE, __edit_mode_available toggles tweaksAvailable,
// __edit_mode_set_keys forwards to persistEditModeKeys, ELEMENT_SELECTED
// branches by mode, IFRAME_ERROR is logged, CLAUDE_COMPLETE drives
// claudeComplete + sends back chunks/done/error.

import './test-helpers'; // side-effect: registers vi.mock for PreviewIframe + api + claudeComplete + html-to-image
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import { PreviewPanel } from '../PreviewPanel';
import { api } from '@/lib/api';
import { claudeComplete } from '@/lib/claude-complete';

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
const claudeCompleteMock = claudeComplete as unknown as ReturnType<typeof vi.fn>;

// Default to a project with one App.jsx file so PreviewPanel mounts the
// PreviewIframe stub (it bails out with a placeholder when files=[] / srcdoc='').
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
    if (path.includes('/files/') && method === 'PUT') return undefined;
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
  claudeCompleteMock.mockReset();
  setupApiWithFile();
  claudeCompleteMock.mockResolvedValue('mock-completion');
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Mount PreviewPanel and switch to a non-DESIGN_FILES_TAB so the iframe path
 * is taken. Returns once the bridge stub is wired up (postMessage ready).
 */
async function mountReady(): Promise<void> {
  renderWithProviders(<PreviewPanel />);
  // Switch tab so PreviewPanel renders the PreviewIframe (else returns placeholder).
  await waitFor(() => expect(getWorkspace).not.toThrow());
  act(() => {
    getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' });
  });
  // Wait for the file-fetch effect to populate `files` so srcdoc !== '' and
  // PreviewIframe stub mounts → handleIframeReady fires.
  await waitFor(() => expect(getStubIframe()).toBeTruthy());
}

describe('PreviewPanel bridge — message routing', () => {
  it('OVERLAY_READY echoes SET_MODE with the current tool', async () => {
    await mountReady();
    // No tool active by default → SET_MODE { mode: null }
    act(() => emitFromIframe({ type: 'OVERLAY_READY' }));

    const setModeCalls = postedMessages<{ type: string; mode: unknown; __codesign?: boolean }>(
      'SET_MODE',
    );
    expect(setModeCalls.length).toBeGreaterThanOrEqual(1);
    const last = setModeCalls.at(-1);
    expect(last).toMatchObject({ __codesign: true, type: 'SET_MODE', mode: null });
  });

  it('OVERLAY_READY echoes the active tool when one is set', async () => {
    await mountReady();
    act(() => getWorkspace().actions.setTool('comment'));
    // Clear out any sends triggered by the tool-change effect.
    getPostMessageSpy().mockClear();

    act(() => emitFromIframe({ type: 'OVERLAY_READY' }));

    const setModeCalls = postedMessages<{ mode: unknown }>('SET_MODE');
    expect(setModeCalls.at(-1)).toMatchObject({ mode: 'comment' });
  });

  it('__edit_mode_available activates Edit-mode UI when tool is already tweaks', async () => {
    await mountReady();
    act(() => getWorkspace().actions.setTool('tweaks'));
    getPostMessageSpy().mockClear();

    act(() => emitFromIframe({ type: '__edit_mode_available' }));

    // Two sends fire: one from the bridge handler itself, and one from the
    // tool-effect re-running when tweaksAvailable transitions true. They are
    // identical and idempotent on the artifact side; we assert at-least-one
    // rather than exactly-one so a future de-dup doesn't break this test.
    const activates = postedMessages<{ type: string }>('__activate_edit_mode');
    expect(activates.length).toBeGreaterThanOrEqual(1);
    expect(activates[0]).toEqual({ type: '__activate_edit_mode' });
  });

  it('__edit_mode_available alone does not activate when tool is not tweaks', async () => {
    await mountReady();
    // No tool set → tweaksAvailable becomes true but no __activate_edit_mode
    getPostMessageSpy().mockClear();

    act(() => emitFromIframe({ type: '__edit_mode_available' }));

    expect(postedMessages('__activate_edit_mode')).toHaveLength(0);
  });

  it('__edit_mode_set_keys triggers a PUT with the merged EDITMODE block', async () => {
    const sourceWithBlock =
      'export default function App() {\n  /*EDITMODE-BEGIN*/{"a":1}/*EDITMODE-END*/\n  return null;\n}';
    apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? 'GET';
      if (path.endsWith('/comments')) return { comments: [] };
      if (path.match(/\/files$/) && method === 'GET') {
        return {
          files: [
            {
              projectId: 'test-project',
              path: 'App.jsx',
              sha256: 'bb',
              size: sourceWithBlock.length,
              mimeType: 'text/jsx',
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      }
      if (path.includes('/files/') && method === 'GET') return sourceWithBlock;
      return undefined;
    });
    await mountReady();
    apiMock.mockClear();

    act(() =>
      emitFromIframe({
        type: '__edit_mode_set_keys',
        edits: { b: 2 },
      }),
    );

    await waitFor(() => {
      const putCalls = apiMock.mock.calls.filter(
        ([, init]) => (init as { method?: string } | undefined)?.method === 'PUT',
      );
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
    });
    const putCall = apiMock.mock.calls.find(
      ([, init]) => (init as { method?: string } | undefined)?.method === 'PUT',
    )!;
    const body = (putCall[1] as { body: unknown }).body as { content: string };
    expect(body.content).toContain('"a": 1');
    expect(body.content).toContain('"b": 2');
  });

  it('ELEMENT_SELECTED with mode=edit captures the selection details', async () => {
    await mountReady();
    act(() => getWorkspace().actions.setTool('edit'));

    // Edit mode triggers __deactivate_edit_mode and SET_MODE; we only care about state side.
    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'edit',
        selector: '.button',
        tag: 'BUTTON',
        outerHTML: '<button>Click</button>',
        styles: { 'background-color': 'rgb(255, 0, 0)' },
        rect: { x: 0, y: 0, w: 50, h: 20 },
      }),
    );

    // No direct state assertion path for editSelection (it lives in PreviewPanel
    // useState, not workspace). Verify EDIT_STYLE goes through after a style
    // change — that proves editSelection was set.
    // (covered in PreviewPanel.edit-writeback.test.tsx)
    // Here just verify no error and no spurious state pollution.
    expect(getWorkspace().state.drawingPin).toBeNull();
  });

  it('ELEMENT_SELECTED with mode=comment dispatches a draft pin into workspace state', async () => {
    await mountReady();
    act(() => getWorkspace().actions.setTool('comment'));

    act(() =>
      emitFromIframe({
        type: 'ELEMENT_SELECTED',
        mode: 'comment',
        selector: '.target',
        tag: 'DIV',
        outerHTML: '<div></div>',
        styles: {},
        rect: { x: 10, y: 20, w: 100, h: 50 },
      }),
    );

    const pin = getWorkspace().state.drawingPin;
    expect(pin).not.toBeNull();
    expect(pin?.x).toBe(60); // x + w/2
    expect(pin?.y).toBe(45); // y + h/2
    expect(pin?.selector).toBe('.target');
  });

  it('IFRAME_ERROR logs without throwing', async () => {
    await mountReady();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() =>
      emitFromIframe({
        type: 'IFRAME_ERROR',
        message: 'something broke',
      }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('iframe error'),
      'something broke',
    );
    warnSpy.mockRestore();
  });

  it('CLAUDE_COMPLETE forwards prompt to claudeComplete and sends DONE on success', async () => {
    claudeCompleteMock.mockResolvedValue('full text');
    await mountReady();
    getPostMessageSpy().mockClear();

    act(() =>
      emitFromIframe({
        type: 'CLAUDE_COMPLETE',
        id: 'rpc-1',
        prompt: 'hello',
      }),
    );

    // Wait for the async claudeComplete promise to resolve and the DONE
    // message to be sent.
    await waitFor(() => {
      expect(postedMessages('CLAUDE_COMPLETE_DONE').length).toBeGreaterThan(0);
    });

    expect(claudeCompleteMock).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ onChunk: expect.any(Function) }),
    );
    const done = postedMessages<{ id: string; text: string }>('CLAUDE_COMPLETE_DONE')[0];
    expect(done).toMatchObject({ id: 'rpc-1', text: 'full text', __codesign: true });
  });

  it('CLAUDE_COMPLETE forwards onChunk callbacks as CLAUDE_COMPLETE_CHUNK messages', async () => {
    claudeCompleteMock.mockImplementation(async (_prompt, opts) => {
      opts?.onChunk?.('hel');
      opts?.onChunk?.('lo');
      return 'hello';
    });
    await mountReady();
    getPostMessageSpy().mockClear();

    act(() =>
      emitFromIframe({
        type: 'CLAUDE_COMPLETE',
        id: 'rpc-2',
        prompt: 'p',
      }),
    );

    await waitFor(() => {
      expect(postedMessages('CLAUDE_COMPLETE_DONE').length).toBeGreaterThan(0);
    });

    const chunks = postedMessages<{ id: string; chunk: string }>('CLAUDE_COMPLETE_CHUNK');
    expect(chunks.map((c) => c.chunk)).toEqual(['hel', 'lo']);
  });

  it('CLAUDE_COMPLETE sends ERROR when claudeComplete rejects', async () => {
    claudeCompleteMock.mockRejectedValue(new Error('No API key configured'));
    await mountReady();
    getPostMessageSpy().mockClear();

    act(() =>
      emitFromIframe({
        type: 'CLAUDE_COMPLETE',
        id: 'rpc-err',
        prompt: 'p',
      }),
    );

    await waitFor(() => {
      expect(postedMessages('CLAUDE_COMPLETE_ERROR').length).toBeGreaterThan(0);
    });

    const err = postedMessages<{ id: string; message: string }>('CLAUDE_COMPLETE_ERROR')[0];
    expect(err).toMatchObject({ id: 'rpc-err', message: 'No API key configured' });
  });
});
