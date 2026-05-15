// Composer — paste image as attachment.
//
// Paste an image item from the clipboard and verify it surfaces as a
// data-URL-backed PendingAttachment that the Composer renders as a
// thumbnail and forwards to onSubmit when the user sends. Plain-text
// pastes must remain untouched (no attachment, no preventDefault interference).

import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { Composer } from '../Composer';
import { theme } from '@/theme/theme';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onSubmit = vi.fn();
  const onChange = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <Composer
        projectId="p1"
        value="hello"
        onChange={onChange}
        onSubmit={onSubmit}
        {...overrides}
      />
    </ThemeProvider>,
  );
  return { onSubmit, onChange };
}

// jsdom 不实现 DataTransfer。Composer 的 paste handler 只读 clipboardData.items
// 的 (kind, type, getAsFile) —— 用最小满足接口的 fake 即可。
function makeImageClipboardData(file: File): Partial<DataTransfer> {
  const item: Partial<DataTransferItem> = {
    kind: 'file',
    type: file.type,
    getAsFile: () => file,
  };
  return { items: [item as DataTransferItem] as unknown as DataTransferItemList };
}

function makeEmptyClipboardData(): Partial<DataTransfer> {
  return { items: [] as unknown as DataTransferItemList };
}

describe('Composer paste image', () => {
  it('paste image item adds attachment thumbnail', async () => {
    const { onSubmit } = renderComposer();
    const ta = screen.getByLabelText(/composer/i);
    const file = new File([new Uint8Array([1, 2, 3])], 'p.png', { type: 'image/png' });
    fireEvent.paste(ta, { clipboardData: makeImageClipboardData(file) });
    await waitFor(() => {
      const img = screen.getByAltText('p.png');
      expect(img).toBeInTheDocument();
      expect((img as HTMLImageElement).src).toMatch(/^data:image\/png;base64,/);
    });
    expect(onSubmit).not.toHaveBeenCalled(); // paste 不立即 submit
  });

  it('text-only paste does not add attachment', async () => {
    const { onSubmit } = renderComposer();
    const ta = screen.getByLabelText(/composer/i);
    fireEvent.paste(ta, { clipboardData: makeEmptyClipboardData() });
    await new Promise((r) => setTimeout(r, 30));
    // 仅检查 attachment thumbnail 没出现 —— 现有 UI 里没有别的 <img>，但用更精确
    // 的查询避免与未来变动碰撞：没有 alt 像 *.png 的图。
    expect(screen.queryAllByRole('img').length).toBe(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit forwards attachments to onSubmit and clears them', async () => {
    const { onSubmit } = renderComposer();
    const ta = screen.getByLabelText(/composer/i);
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    fireEvent.paste(ta, { clipboardData: makeImageClipboardData(file) });
    await screen.findByAltText('a.png');
    const send = screen.getByLabelText(/send/i);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0]?.[0] as Array<{
      mediaType: string;
      url: string;
      filename?: string;
    }>;
    expect(arg).toHaveLength(1);
    expect(arg[0]?.mediaType).toBe('image/png');
    expect(arg[0]?.url).toMatch(/^data:image\/png;base64,/);
    expect(arg[0]?.filename).toBe('a.png');
    // attachment 已 clear（thumbnail 消失）
    await waitFor(() => {
      expect(screen.queryByAltText('a.png')).not.toBeInTheDocument();
    });
  });

  it('paste also fires R2 PUT to /files/uploads/<filename>', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ path: 'uploads/x.png', sha256: 'abc', size: 1, version: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderComposer();
    const ta = screen.getByLabelText(/composer/i);
    const file = new File([new Uint8Array([1, 2, 3])], 'screenshot.png', { type: 'image/png' });
    fireEvent.paste(ta, { clipboardData: makeImageClipboardData(file) });
    await screen.findByAltText('screenshot.png');
    // 等 microtask 跑完
    await new Promise((r) => setTimeout(r, 30));

    // 找到 PUT call
    const putCall = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(String(putCall![0])).toMatch(/\/api\/projects\/p1\/files\/uploads\/screenshot\.png$/);
    expect(putCall![1]?.body).toBe(file);
    const headers = putCall![1]?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('image/png');
  });

  it('paste with empty file.name uses pasted-<ISO>-<rand> filename for both attachment and R2 PUT', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    renderComposer();
    const ta = screen.getByLabelText(/composer/i);
    const file = new File([new Uint8Array([1])], '', { type: 'image/png' });
    fireEvent.paste(ta, { clipboardData: makeImageClipboardData(file) });
    await new Promise((r) => setTimeout(r, 30));

    // attachment filename 跟 PUT URL filename 一致
    const imgs = screen.queryAllByRole('img');
    const altName = imgs
      .find((i) => i.getAttribute('alt')?.startsWith('pasted-'))
      ?.getAttribute('alt');
    expect(altName).toMatch(/^pasted-[\d-]+T[\d-]+.+\.png$/);

    const putCall = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(String(putCall![0])).toContain(encodeURIComponent(altName ?? ''));
  });

  it('R2 PUT failure does not block thumbnail render or attachment state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderComposer();
    const ta = screen.getByLabelText(/composer/i);
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    fireEvent.paste(ta, { clipboardData: makeImageClipboardData(file) });

    // thumbnail 仍 render
    await screen.findByAltText('x.png');
    // warn 被调用
    await new Promise((r) => setTimeout(r, 30));
    expect(warnSpy).toHaveBeenCalled();
  });
});
