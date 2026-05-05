// PreviewPanel — Draw mode send + undo + discard.
//
// Send: snapshots the iframe DOM via html-to-image, queues a chat submit
// with the screenshot as a data-URL attachment, then clears strokes and
// exits Draw mode. Undo / Discard are simple workspace state operations
// already covered by reducer tests; here we ensure the dock buttons wire to
// them correctly.

import './test-helpers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { PreviewPanel } from '../PreviewPanel';
import { api } from '@/lib/api';
import { toPng } from 'html-to-image';

import {
  getStubIframe,
  getWorkspace,
  installPreviewTestEnv,
  renderWithProviders,
  resetPreviewStubState,
  resetWorkspaceCapture,
} from './test-helpers';

const apiMock = api as unknown as ReturnType<typeof vi.fn>;
const toPngMock = toPng as unknown as ReturnType<typeof vi.fn>;

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
  toPngMock.mockReset();
  toPngMock.mockResolvedValue('data:image/png;base64,STUB');
  setupApiWithFile();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountInDrawMode(): Promise<void> {
  renderWithProviders(<PreviewPanel />);
  await waitFor(() => expect(getWorkspace).not.toThrow());
  act(() => getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
  await waitFor(() => expect(getStubIframe()).toBeTruthy());
  act(() => getWorkspace().actions.setTool('draw'));
}

function pushStroke(): void {
  act(() => {
    getWorkspace().dispatch({
      type: 'begin_draw',
      stroke: { type: 'draw', points: [[0, 0]] },
    });
    getWorkspace().dispatch({ type: 'extend_drawing', point: [10, 10] });
    getWorkspace().dispatch({ type: 'end_drawing' });
  });
}

describe('PreviewPanel Draw mode', () => {
  it('renders the dock and disables Send when stroke count is zero', async () => {
    await mountInDrawMode();
    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    expect(sendBtn).toBeDisabled();
  });

  it('Undo and Discard wire to the workspace actions', async () => {
    await mountInDrawMode();
    pushStroke();
    pushStroke();
    expect(getWorkspace().state.drawStrokes).toHaveLength(2);

    const undoBtn = screen.getByTestId('draw-undo');
    act(() => fireEvent.click(undoBtn));
    expect(getWorkspace().state.drawStrokes).toHaveLength(1);

    const discardBtn = screen.getByTestId('draw-discard');
    act(() => fireEvent.click(discardBtn));
    expect(getWorkspace().state.drawStrokes).toHaveLength(0);
    // Discard also clears the tool back to null.
    expect(getWorkspace().state.tool).toBeNull();
  });

  it('Send invokes html-to-image and queues a chat submit with the screenshot', async () => {
    await mountInDrawMode();
    pushStroke();

    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    expect(sendBtn).not.toBeDisabled();
    act(() => fireEvent.click(sendBtn));

    await waitFor(() => expect(toPngMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const submit = getWorkspace().state.pendingChatSubmit;
      expect(submit).not.toBeNull();
    });
    const submit = getWorkspace().state.pendingChatSubmit!;
    expect(submit.text).toContain('1 mark');
    expect(submit.attachments).toBeDefined();
    expect(submit.attachments?.[0]).toMatchObject({
      mediaType: 'image/png',
      url: 'data:image/png;base64,STUB',
    });
  });

  it('Send uses the typed note as chat text + appends annotations tag (img_6 design)', async () => {
    await mountInDrawMode();
    pushStroke();
    pushStroke();

    const noteInput = screen.getByPlaceholderText('Type anywhere to add a note');
    act(() => {
      fireEvent.change(noteInput, { target: { value: 'fix the header alignment' } });
    });

    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    act(() => fireEvent.click(sendBtn));

    await waitFor(() => {
      const submit = getWorkspace().state.pendingChatSubmit;
      expect(submit).not.toBeNull();
    });
    const submit = getWorkspace().state.pendingChatSubmit!;
    expect(submit.text).toContain('fix the header alignment');
    expect(submit.text).toContain('2 annotations attached');
  });

  it('Send falls back to default copy when note is empty', async () => {
    await mountInDrawMode();
    pushStroke();

    // No note typed.
    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    act(() => fireEvent.click(sendBtn));

    await waitFor(() => {
      const submit = getWorkspace().state.pendingChatSubmit;
      expect(submit).not.toBeNull();
    });
    const submit = getWorkspace().state.pendingChatSubmit!;
    expect(submit.text).toContain('Annotated screenshot');
    expect(submit.text).toContain('1 mark');
  });

  it('Send clears the note after sending', async () => {
    await mountInDrawMode();
    pushStroke();
    const noteInput = screen.getByPlaceholderText(
      'Type anywhere to add a note',
    ) as HTMLTextAreaElement;
    act(() => {
      fireEvent.change(noteInput, { target: { value: 'temporary' } });
    });
    expect(noteInput.value).toBe('temporary');

    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    act(() => fireEvent.click(sendBtn));

    // After Send, the dock unmounts (tool=null) so the textarea is gone too;
    // re-entering Draw mode should yield a fresh empty textarea.
    await waitFor(() => expect(getWorkspace().state.tool).toBeNull());
    act(() => getWorkspace().actions.setTool('draw'));
    const refreshed = screen.getByPlaceholderText(
      'Type anywhere to add a note',
    ) as HTMLTextAreaElement;
    expect(refreshed.value).toBe('');
  });

  it('Send still queues a text-only chat submit when toPng fails', async () => {
    toPngMock.mockRejectedValue(new Error('cross-origin'));
    await mountInDrawMode();
    pushStroke();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    act(() => fireEvent.click(sendBtn));

    await waitFor(() => {
      const submit = getWorkspace().state.pendingChatSubmit;
      expect(submit).not.toBeNull();
    });
    const submit = getWorkspace().state.pendingChatSubmit!;
    expect(submit.attachments).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith('[draw] screenshot failed', expect.any(Error));
    warnSpy.mockRestore();
  });

  it('Send clears strokes and exits Draw mode after queuing', async () => {
    await mountInDrawMode();
    pushStroke();

    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    act(() => fireEvent.click(sendBtn));

    await waitFor(() => {
      const ws = getWorkspace();
      expect(ws.state.drawStrokes).toHaveLength(0);
      expect(ws.state.tool).toBeNull();
    });
  });

  it('Send is a no-op when there are no strokes (defensive)', async () => {
    await mountInDrawMode();
    // Send button is disabled at strokeCount=0 — verify by checking the
    // attribute, not by clicking (clicking a disabled button still fires
    // the click handler in jsdom but DrawDock won't dispatch it).
    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    expect(sendBtn).toBeDisabled();
    expect(toPngMock).not.toHaveBeenCalled();
  });

  it('sub-mode toggle (Draw / Point) updates workspace state via dispatch', async () => {
    await mountInDrawMode();
    expect(getWorkspace().state.drawSubMode).toBe('draw');

    const pointBtn = screen.getByRole('button', { name: /Point/i });
    act(() => fireEvent.click(pointBtn));
    expect(getWorkspace().state.drawSubMode).toBe('click');

    const drawBtn = screen.getByRole('button', { name: /^Draw/ });
    act(() => fireEvent.click(drawBtn));
    expect(getWorkspace().state.drawSubMode).toBe('draw');
  });

  it('Voice submode button advertises aria-disabled for screen readers (a11y-Voice)', async () => {
    // disabled prop alone doesn't reliably announce to all SR/AT combos —
    // explicit aria-disabled="true" is the WCAG-preferred signal for buttons
    // that are visually present but not interactable.
    await mountInDrawMode();
    const voiceBtn = screen.getByTestId('draw-submode-voice');
    expect(voiceBtn).toHaveAttribute('aria-disabled', 'true');
    // Native disabled stays — keyboard / pointer events shouldn't fire.
    expect(voiceBtn).toBeDisabled();
  });
});
