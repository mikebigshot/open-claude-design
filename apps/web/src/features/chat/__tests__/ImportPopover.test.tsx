// ImportPopover — file upload + 4-disabled-options dropdown.
//
// 上传路径：FileReader → dataURL → onAttachmentAdd（即时 thumbnail），
// 跟 Composer paste 同模式，并 fire-and-forget PUT /files/uploads/<name> 让
// file 进 file tree。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { ImportPopover } from '../ImportPopover';
import { theme } from '@/theme/theme';

// Stub global.fetch — ImportPopover 触发的是 fire-and-forget R2 PUT
let fetchMock: ReturnType<typeof vi.fn>;

function renderPopover(props: Partial<React.ComponentProps<typeof ImportPopover>> = {}): {
  onClose: ReturnType<typeof vi.fn>;
  onAttachmentAdd: ReturnType<typeof vi.fn>;
  onAttachSkillRequested: ReturnType<typeof vi.fn>;
} {
  const onClose = vi.fn();
  const onAttachmentAdd = vi.fn();
  const onAttachSkillRequested = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <ImportPopover
        open
        projectId="proj1"
        onClose={onClose}
        onAttachmentAdd={onAttachmentAdd}
        onAttachSkillRequested={onAttachSkillRequested}
        {...props}
      />
    </ThemeProvider>,
  );
  return { onClose, onAttachmentAdd, onAttachSkillRequested };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  cleanup();
  // 等 fire-and-forget promise + FileReader microtask drain，否则会漏到下个 test
  await new Promise((r) => setTimeout(r, 30));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ImportPopover', () => {
  it('returns null when open=false', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <ImportPopover
          open={false}
          projectId="p"
          onClose={() => {}}
          onAttachmentAdd={() => {}}
          onAttachSkillRequested={() => {}}
        />
      </ThemeProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders 6 menu items (4 SOON + Upload + Attach skill active)', () => {
    renderPopover();
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(6);

    const upload = items.find((i) => i.textContent?.includes('Upload'))!;
    const codebase = items.find((i) => i.textContent?.includes('Local codebase'))!;
    const attachSkill = items.find((i) => i.textContent?.includes('Attach skill'))!;
    expect(upload).not.toBeDisabled();
    expect(codebase).toBeDisabled();
    expect(codebase.textContent).toContain('SOON');
    // Attach skill is active, no SOON badge
    expect(attachSkill).not.toBeDisabled();
    expect(attachSkill.textContent).not.toContain('SOON');
  });

  it('clicking "Attach skill" fires onAttachSkillRequested', () => {
    const { onAttachSkillRequested } = renderPopover();
    const attachSkill = screen
      .getAllByRole('menuitem')
      .find((i) => i.textContent?.includes('Attach skill'))!;
    act(() => fireEvent.click(attachSkill));
    expect(onAttachSkillRequested).toHaveBeenCalled();
  });

  it('outside-click triggers onClose', () => {
    const { onClose } = renderPopover();
    act(() => fireEvent.mouseDown(document.body));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking on the popover itself does not call onClose (mousedown stays inside)', () => {
    const { onClose } = renderPopover();
    const popover = screen.getByRole('menu');
    act(() => fireEvent.mouseDown(popover));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking a disabled option is a no-op (no fetch, no attachment)', () => {
    const { onAttachmentAdd } = renderPopover();
    const codebase = screen
      .getAllByRole('menuitem')
      .find((i) => i.textContent?.includes('Local codebase'))!;
    act(() => fireEvent.click(codebase));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onAttachmentAdd).not.toHaveBeenCalled();
  });

  it('successful file selection: emits PendingAttachment + fires R2 PUT', async () => {
    const { onAttachmentAdd, onClose } = renderPopover();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // attachment 加上（FileReader.readAsDataURL 是 async，等 microtask）
    await waitFor(() => expect(onAttachmentAdd).toHaveBeenCalledTimes(1));
    const attachment = onAttachmentAdd.mock.calls[0]![0];
    expect(attachment.mediaType).toBe('image/png');
    expect(attachment.filename).toBe('shot.png');
    expect(attachment.url).toMatch(/^data:image\/png;base64,/);

    // fire-and-forget R2 PUT 也发出
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/projects/proj1/files/uploads/shot.png');
    expect((init as RequestInit).method).toBe('PUT');
    expect((init as RequestInit).body).toBe(file);

    expect(onClose).toHaveBeenCalled();
  });

  it('R2 PUT non-2xx: attachment still added (fire-and-forget, console.warn)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { onAttachmentAdd } = renderPopover();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'x.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // attachment 仍加（PUT 失败不阻塞 thumbnail UX）
    await waitFor(() => expect(onAttachmentAdd).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith('[upload] R2 put failed', 'x.png', 500),
    );
    warnSpy.mockRestore();
  });

  it('R2 PUT throws: attachment still added', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { onAttachmentAdd } = renderPopover();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => expect(onAttachmentAdd).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith('[upload] R2 put error', 'a.png', expect.any(Error)),
    );
    warnSpy.mockRestore();
  });

  it('default endpoint URL-encodes special characters in filename and projectId', async () => {
    cleanup();
    const onAttachmentAdd = vi.fn();
    render(
      <ThemeProvider theme={theme}>
        <ImportPopover
          open
          projectId="proj space"
          onClose={() => {}}
          onAttachmentAdd={onAttachmentAdd}
          onAttachSkillRequested={() => {}}
        />
      </ThemeProvider>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'foo bar.png', { type: 'image/png' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/projects/proj%20space/files/uploads/foo%20bar.png',
    );
  });
});
