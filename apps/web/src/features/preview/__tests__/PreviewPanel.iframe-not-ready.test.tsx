// PreviewPanel — P2-13: iframe-not-ready 时工具浮窗不应渲染。
//
// 视觉违和场景：用户刚 create project 还没 prompt agent → files=[] → srcdoc=''
// → PreviewPanel 走 `<Centered>Start chatting...</Centered>` placeholder 分支。
// 用户此时点 Toolbar 上的 Edit / Draw 按钮，state.tool 切到 edit/draw，
// 但旧逻辑里 EditFloat / DrawDock 仍渲染（漂浮在 placeholder 上面）—— 视觉违和。
//
// 期望：iframe 没 srcdoc / 没文件落盘时，工具浮窗应隐藏，并显示提示
// "Generate a preview first..."。tweaks hint 已经走类似逻辑，保持一致。

import './test-helpers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';

import { PreviewPanel } from '../PreviewPanel';
import { api } from '@/lib/api';

import {
  getWorkspace,
  installPreviewTestEnv,
  renderWithProviders,
  resetPreviewStubState,
  resetWorkspaceCapture,
} from './test-helpers';

const apiMock = api as unknown as ReturnType<typeof vi.fn>;

/** 0 文件 mock —— srcdoc 永远是空，PreviewPanel 走 placeholder 分支。*/
function setupApiNoFiles(): void {
  apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (path.endsWith('/comments') && method === 'GET') return { comments: [] };
    if (path.match(/\/files$/) && method === 'GET') return { files: [] };
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
  setupApiNoFiles();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountEmptyProject(): Promise<void> {
  renderWithProviders(<PreviewPanel />);
  await waitFor(() => expect(getWorkspace).not.toThrow());
  // active tab not Design Files —— PreviewPanel 走 iframe 分支（虽然 srcdoc='')
  act(() => getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));
  // 等 file fetch 跑完，确认 placeholder 出现
  await waitFor(() =>
    expect(screen.getByText(/Start chatting to generate your first preview/i)).toBeInTheDocument(),
  );
}

describe('PreviewPanel iframe-not-ready (P2-13)', () => {
  it('does not render EditFloat when iframe has no srcdoc / no files', async () => {
    await mountEmptyProject();
    act(() => getWorkspace().actions.setTool('edit'));

    // 工具按 active 是的，但浮窗不应渲染
    expect(getWorkspace().state.tool).toBe('edit');
    expect(screen.queryByTestId('edit-float')).toBeNull();
  });

  it('does not render DrawDock when iframe has no srcdoc / no files', async () => {
    await mountEmptyProject();
    act(() => getWorkspace().actions.setTool('draw'));

    expect(getWorkspace().state.tool).toBe('draw');
    expect(screen.queryByTestId('draw-dock')).toBeNull();
  });

  it('shows a "generate preview first" hint when entering Edit on empty project', async () => {
    await mountEmptyProject();
    act(() => getWorkspace().actions.setTool('edit'));

    // ModeHint variant —— 至少包含 "preview" / "generate" 字样
    const hint = await screen.findByTestId('preview-empty-tool-hint');
    expect(hint.textContent).toMatch(/generate|preview first|first preview/i);
  });

  it('shows a "generate preview first" hint when entering Draw on empty project', async () => {
    await mountEmptyProject();
    act(() => getWorkspace().actions.setTool('draw'));

    const hint = await screen.findByTestId('preview-empty-tool-hint');
    expect(hint.textContent).toMatch(/generate|preview first|first preview/i);
  });

  it('shows a "generate preview first" hint when entering Tweaks on empty project', async () => {
    await mountEmptyProject();
    act(() => getWorkspace().actions.setTool('tweaks'));

    // Tweaks 在 empty 状态下也应走 empty-tool-hint（artifact 都没渲染过，不可能 expose Tweaks）
    const hint = await screen.findByTestId('preview-empty-tool-hint');
    expect(hint.textContent).toMatch(/generate|preview first|first preview/i);
  });

  it('renders placeholder (no iframe) when project has only binary files', async () => {
    // 用户 paste 几张 PNG 还没让 agent 写代码 —— files 非空但全是 image/png。
    // 旧逻辑会让 buildSrcdoc 生成只含 React-globals + auto-entry 的空 babel
    // script，iframe console 红字 `Uncaught ReferenceError: App is not defined`。
    // 新逻辑：isInlineableTextFile === false 的全 binary 项目走 placeholder。
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.endsWith('/comments') && method === 'GET') return { comments: [] };
      if (path.match(/\/files$/) && method === 'GET') {
        return {
          files: [
            {
              projectId: 'test-project',
              path: 'uploads/photo.png',
              sha256: 'aa',
              size: 1024,
              mimeType: 'image/png',
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      }
      // file content endpoint —— api() returns the raw bytes-as-text (we don't
      // actually inspect content here; the placeholder branch fires before
      // build-srcdoc runs).
      if (path.includes('/files/') && method === 'GET') return '\x89PNG\r\n\x1a\n';
      return undefined;
    });

    renderWithProviders(<PreviewPanel />);
    await waitFor(() => expect(getWorkspace).not.toThrow());
    act(() => getWorkspace().dispatch({ type: 'set_active_tab', tab: 'uploads/photo.png' }));

    // 等 file fetch 完成，placeholder 仍在
    await waitFor(() =>
      expect(
        screen.getByText(/Start chatting to generate your first preview/i),
      ).toBeInTheDocument(),
    );
    // 没有 iframe stub —— 没渲染 PreviewIframe
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders EditFloat normally once a file is loaded (regression guard)', async () => {
    // 先用空 mock 起来，跑过 mount，再切到有文件 mock —— 模拟 agent 生成完成
    const SOURCE = 'export default () => <button>Hi</button>;';
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
              size: SOURCE.length,
              mimeType: 'text/jsx',
              updatedAt: new Date().toISOString(),
            },
          ],
        };
      }
      if (path.includes('/files/') && method === 'GET') return SOURCE;
      return undefined;
    });

    renderWithProviders(<PreviewPanel />);
    await waitFor(() => expect(getWorkspace).not.toThrow());
    act(() => getWorkspace().dispatch({ type: 'set_active_tab', tab: 'App.jsx' }));

    // 等文件加载完 + iframe srcdoc 非空。此时 PreviewPanel 应渲 PreviewIframe stub
    await waitFor(() =>
      expect(
        screen.queryByText(/Start chatting to generate your first preview/i),
      ).not.toBeInTheDocument(),
    );

    act(() => getWorkspace().actions.setTool('edit'));

    // 浮窗应回归
    expect(screen.getByTestId('edit-float')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-empty-tool-hint')).toBeNull();
  });
});
