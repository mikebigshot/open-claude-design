// ChatTabBar — 第二行 SecondaryHeader 左侧的 chat tab 栏（Task 8 + Task 2）。
//
// 覆盖：
//   - 渲染所有 chats（按 state.chats 顺序）
//   - 默认 title null → 显示 'Chat 1' / 'Chat 2'
//   - 点 chat tab 触发 onSelect({ kind: 'chat', chatId })
//   - 点 + 触发 actions.createChat
//   - 双击 chat tab 进入 inline rename，输入 + Enter 调 actions.renameChat
//   - 右键弹删除确认弹窗，点 Delete 调 actions.deleteChat（最后一条 chat 不让删）
//   - 点 Comments / Activity 切到 reserved 视图
//   - aria 选中态正确

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';
import { WorkspaceProvider, useWorkspace } from '@/state/workspace';
import type { Chat } from '@open-design/contracts';
import { ChatTabBar, type ChatViewSelection } from '../ChatTabBar';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: vi.fn(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (path.includes('/chats') && method === 'GET') return { chats: [] };
    if (path.includes('/chats') && method === 'POST') return { chat: makeChat('new', null) };
    if (path.includes('/comments') && method === 'GET') return { comments: [] };
    return undefined;
  }),
  ApiError: class extends Error {},
}));

const apiMock = api as unknown as ReturnType<typeof vi.fn>;

function makeChat(id: string, title: string | null = null): Chat {
  return {
    id,
    projectId: 'p1',
    title,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

const workspaceRef: { current: ReturnType<typeof useWorkspace> | null } = { current: null };
function Capture() {
  workspaceRef.current = useWorkspace();
  return null;
}

function renderTabBar({
  selection,
  onSelect,
  commentsCount = 0,
  initialChats,
  initialActiveChatId,
}: {
  selection: ChatViewSelection;
  onSelect: (s: ChatViewSelection) => void;
  commentsCount?: number;
  initialChats?: Chat[];
  initialActiveChatId?: string | null;
}): void {
  function Seeder() {
    const ws = useWorkspace();
    useEffect(() => {
      if (initialChats !== undefined) {
        ws.dispatch({
          type: 'set_chats',
          chats: initialChats,
          activeChatId: initialActiveChatId ?? null,
        });
      }
      // intentionally one-shot per test render
    }, []);
    return null;
  }

  render(
    <ThemeProvider theme={theme}>
      <WorkspaceProvider projectId="p1">
        <Capture />
        <Seeder />
        <ChatTabBar selection={selection} onSelect={onSelect} commentsCount={commentsCount} />
      </WorkspaceProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  apiMock.mockClear();
  workspaceRef.current = null;
});

afterEach(() => {
  cleanup();
});

describe('ChatTabBar', () => {
  it('renders one tab per chat with default labels when title is null', () => {
    const onSelect = vi.fn();
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect,
      initialChats: [makeChat('a'), makeChat('b')],
      initialActiveChatId: 'a',
    });
    expect(screen.getByText('Chat 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 2')).toBeInTheDocument();
  });

  it('renders custom titles when present', () => {
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect: vi.fn(),
      initialChats: [makeChat('a', 'Hello'), makeChat('b', null)],
      initialActiveChatId: 'a',
    });
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Chat 2')).toBeInTheDocument();
  });

  it('aria-selected reflects selection.chatId', () => {
    renderTabBar({
      selection: { kind: 'chat', chatId: 'b' },
      onSelect: vi.fn(),
      initialChats: [makeChat('a'), makeChat('b')],
      initialActiveChatId: 'b',
    });
    const tabA = screen.getByTestId('chat-tab-a');
    const tabB = screen.getByTestId('chat-tab-b');
    expect(tabA.getAttribute('aria-selected')).toBe('false');
    expect(tabB.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking a chat tab fires onSelect with kind=chat', () => {
    const onSelect = vi.fn();
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect,
      initialChats: [makeChat('a'), makeChat('b')],
    });
    act(() => fireEvent.click(screen.getByTestId('chat-tab-b')));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'chat', chatId: 'b' });
  });

  it('clicking + creates a pending placeholder chat (no POST until first send)', async () => {
    apiMock.mockClear();
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') {
        return { chats: [makeChat('a')] };
      }
      if (path.includes('/comments') && method === 'GET') return { comments: [] };
      return undefined;
    });

    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect: vi.fn(),
      initialChats: [makeChat('a')],
      initialActiveChatId: 'a',
    });
    act(() => fireEvent.click(screen.getByTestId('chat-tab-new')));
    // 前端 placeholder 立即出现
    await screen.findByText('Chat 2');
    // 关键：还没 POST /chats（lazy create 行为）
    const postCalls = apiMock.mock.calls.filter(
      ([path, init]) => path.includes('/chats') && (init as { method?: string })?.method === 'POST',
    );
    expect(postCalls.length).toBe(0);
  });

  it('clicking + while a pending chat already exists does not duplicate it', async () => {
    apiMock.mockClear();
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return { chats: [makeChat('a')] };
      if (path.includes('/comments') && method === 'GET') return { comments: [] };
      return undefined;
    });

    const onSelect = vi.fn();
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect,
      initialChats: [makeChat('a')],
      initialActiveChatId: 'a',
    });
    // 第一次点 + 创建 placeholder
    act(() => fireEvent.click(screen.getByTestId('chat-tab-new')));
    await screen.findByText('Chat 2');

    // 第二次点 + —— 应该 no-op / 切回（不再创建新的）
    act(() => fireEvent.click(screen.getByTestId('chat-tab-new')));
    // chats 仍然只有 2 个（'a' + 1 个 pending），没出 'Chat 3'
    expect(screen.queryByText('Chat 3')).toBeNull();
    // 没有任何 POST /chats 调用（lazy create）
    const postCalls = apiMock.mock.calls.filter(
      ([path, init]) => path.includes('/chats') && (init as { method?: string })?.method === 'POST',
    );
    expect(postCalls.length).toBe(0);
  });

  it('double-click enters rename, Enter commits, fires actions.renameChat', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'PATCH') {
        const body = JSON.parse((init as { body?: string }).body ?? '{}');
        return {
          chat: { ...makeChat('a', body.title), id: 'a' },
        };
      }
      if (path.includes('/chats') && method === 'GET') {
        return { chats: [makeChat('a')] };
      }
      if (path.includes('/comments') && method === 'GET') return { comments: [] };
      return undefined;
    });

    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect: vi.fn(),
      initialChats: [makeChat('a', 'Old name')],
      initialActiveChatId: 'a',
    });

    const tab = screen.getByTestId('chat-tab-a');
    act(() => fireEvent.doubleClick(tab));

    const input = screen.getByLabelText(/Rename Old name/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    act(() => fireEvent.change(input, { target: { value: 'Renamed!' } }));
    act(() => fireEvent.keyDown(input, { key: 'Enter' }));

    await screen.findByText('Renamed!');

    const patchCalls = apiMock.mock.calls.filter(
      ([path, init]) =>
        path.includes('/chats/a') && (init as { method?: string })?.method === 'PATCH',
    );
    expect(patchCalls.length).toBeGreaterThan(0);
    const body = JSON.parse((patchCalls[0]![1] as { body: string }).body);
    expect(body.title).toBe('Renamed!');
  });

  it('rename Escape cancels without firing PATCH', () => {
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect: vi.fn(),
      initialChats: [makeChat('a', 'Stay')],
      initialActiveChatId: 'a',
    });
    const tab = screen.getByTestId('chat-tab-a');
    act(() => fireEvent.doubleClick(tab));
    const input = screen.getByLabelText(/Rename Stay/i) as HTMLInputElement;
    act(() => fireEvent.change(input, { target: { value: 'Renamed!' } }));
    act(() => fireEvent.keyDown(input, { key: 'Escape' }));

    // Tab still shows old title.
    expect(screen.getByText('Stay')).toBeInTheDocument();
    const patchCalls = apiMock.mock.calls.filter(
      ([_path, init]) => (init as { method?: string })?.method === 'PATCH',
    );
    expect(patchCalls.length).toBe(0);
  });

  it('right-click on the only chat does NOT show the delete confirm popover', () => {
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect: vi.fn(),
      initialChats: [makeChat('a')],
      initialActiveChatId: 'a',
    });
    const tab = screen.getByTestId('chat-tab-a');
    act(() => fireEvent.contextMenu(tab));
    // No delete button rendered when there is only one chat.
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('right-click + Delete fires actions.deleteChat (multiple chats present)', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats/a') && method === 'DELETE') return undefined;
      if (path.includes('/chats') && method === 'GET') return { chats: [makeChat('a')] };
      if (path.includes('/comments') && method === 'GET') return { comments: [] };
      return undefined;
    });

    renderTabBar({
      selection: { kind: 'chat', chatId: 'b' },
      onSelect: vi.fn(),
      initialChats: [makeChat('a'), makeChat('b')],
      initialActiveChatId: 'b',
    });

    const tabA = screen.getByTestId('chat-tab-a');
    act(() => fireEvent.contextMenu(tabA));
    const confirm = screen.getByTestId('chat-delete-confirm-a');
    act(() => fireEvent.click(confirm));

    // optimistic remove → tab gone.
    expect(screen.queryByTestId('chat-tab-a')).toBeNull();

    const delCalls = apiMock.mock.calls.filter(
      ([path, init]) =>
        path.includes('/chats/a') && (init as { method?: string })?.method === 'DELETE',
    );
    expect(delCalls.length).toBeGreaterThan(0);
  });

  it('clicking Comments / Activity fires onSelect with the right kind', () => {
    const onSelect = vi.fn();
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect,
      commentsCount: 3,
      initialChats: [makeChat('a')],
      initialActiveChatId: 'a',
    });
    act(() => fireEvent.click(screen.getByTestId('chat-tab-comments')));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'comments' });

    act(() => fireEvent.click(screen.getByTestId('chat-tab-activity')));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'activity' });
  });

  it('Comments badge shows pin count when > 0', () => {
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect: vi.fn(),
      commentsCount: 5,
      initialChats: [makeChat('a')],
    });
    expect(screen.getByText(/Comments \(5\)/)).toBeInTheDocument();
  });

  it('Comments badge is hidden when count = 0', () => {
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect: vi.fn(),
      commentsCount: 0,
      initialChats: [makeChat('a')],
    });
    expect(screen.getByText('Comments')).toBeInTheDocument();
    expect(screen.queryByText(/\(0\)/)).toBeNull();
  });

  it('keyboard Enter on a chat tab fires onSelect (a11y)', () => {
    const onSelect = vi.fn();
    renderTabBar({
      selection: { kind: 'chat', chatId: 'a' },
      onSelect,
      initialChats: [makeChat('a'), makeChat('b')],
    });
    const tabB = screen.getByTestId('chat-tab-b');
    act(() => fireEvent.keyDown(tabB, { key: 'Enter' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'chat', chatId: 'b' });
  });
});
