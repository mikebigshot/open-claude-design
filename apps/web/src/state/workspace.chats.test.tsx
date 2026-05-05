// Multi-chat reducer + actions tests (Task 2).
//
// Two layers:
//   1. Reducer actions: set_chats / set_active_chat / add_chat / rename_chat /
//      remove_chat / set_chats_error 各分支
//   2. Provider actions: createChat / renameChat / deleteChat / setActiveChat
//      —— optimistic dispatch + api round-trip + rollback on failure
//
// 避免触发 hydrate effect 干扰：mock @/lib/api 让 GET /chats 永久 pending（never
// resolves）。每个 case 在测试主体里再设具体 POST/PATCH/DELETE 行为。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  ApiError: class extends Error {},
}));

vi.mock('../components/Toast', () => ({
  showToast: vi.fn(),
}));

import { WorkspaceProvider, useWorkspace } from './workspace';
import { api } from '@/lib/api';
import { showToast } from '../components/Toast';
import type { Chat } from '@open-design/contracts';

const apiMock = api as unknown as ReturnType<typeof vi.fn>;
const showToastMock = showToast as unknown as ReturnType<typeof vi.fn>;

function makeChat(id: string, title: string | null = null): Chat {
  return {
    id,
    projectId: 'p1',
    title,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

const wrapper =
  (projectId = 'p1', readOnly = false) =>
  ({ children }: { children: ReactNode }) => (
    <WorkspaceProvider projectId={projectId} readOnly={readOnly}>
      {children}
    </WorkspaceProvider>
  );

function setup(projectId = 'p1', readOnly = false) {
  return renderHook(() => useWorkspace(), { wrapper: wrapper(projectId, readOnly) });
}

beforeEach(() => {
  apiMock.mockReset();
  showToastMock.mockReset();
  // Default: GET /chats never resolves → no auto-create dance interferes.
  // POST falls through to undefined (caller can override per-test).
  apiMock.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('workspace reducer — chats', () => {
  it('initial state has chats=null and activeChatId=null', () => {
    const { result } = setup();
    expect(result.current.state.chats).toBeNull();
    expect(result.current.state.activeChatId).toBeNull();
    expect(result.current.state.chatsError).toBeNull();
  });

  it('set_chats with empty array clears chats and activeChatId', () => {
    const { result } = setup();
    act(() => result.current.dispatch({ type: 'set_chats', chats: [] }));
    expect(result.current.state.chats).toEqual([]);
    expect(result.current.state.activeChatId).toBeNull();
  });

  it('set_chats picks first chat as activeChatId when not set', () => {
    const { result } = setup();
    const chats = [makeChat('a'), makeChat('b')];
    act(() => result.current.dispatch({ type: 'set_chats', chats }));
    expect(result.current.state.activeChatId).toBe('a');
  });

  it('set_chats keeps activeChatId if it still exists in new list', () => {
    const { result } = setup();
    act(() =>
      result.current.dispatch({ type: 'set_chats', chats: [makeChat('a'), makeChat('b')] }),
    );
    act(() => result.current.dispatch({ type: 'set_active_chat', chatId: 'b' }));
    expect(result.current.state.activeChatId).toBe('b');
    // refresh — b still exists
    act(() =>
      result.current.dispatch({ type: 'set_chats', chats: [makeChat('a'), makeChat('b')] }),
    );
    expect(result.current.state.activeChatId).toBe('b');
  });

  it('set_chats falls back to first when activeChatId vanishes from new list', () => {
    const { result } = setup();
    act(() =>
      result.current.dispatch({ type: 'set_chats', chats: [makeChat('a'), makeChat('b')] }),
    );
    act(() => result.current.dispatch({ type: 'set_active_chat', chatId: 'b' }));
    // Refresh with chats no longer including 'b'
    act(() =>
      result.current.dispatch({ type: 'set_chats', chats: [makeChat('a'), makeChat('c')] }),
    );
    expect(result.current.state.activeChatId).toBe('a');
  });

  it('set_chats with explicit activeChatId override wins', () => {
    const { result } = setup();
    act(() =>
      result.current.dispatch({
        type: 'set_chats',
        chats: [makeChat('a'), makeChat('b')],
        activeChatId: 'b',
      }),
    );
    expect(result.current.state.activeChatId).toBe('b');
  });

  it('set_active_chat just flips activeChatId', () => {
    const { result } = setup();
    act(() =>
      result.current.dispatch({ type: 'set_chats', chats: [makeChat('a'), makeChat('b')] }),
    );
    act(() => result.current.dispatch({ type: 'set_active_chat', chatId: 'b' }));
    expect(result.current.state.activeChatId).toBe('b');
  });

  it('add_chat with setActive appends to end of list and sets active', () => {
    // 新 chat 追加到末尾（chatLabel 按 idx 算，prepend 会让所有老 chat 标签 +1，
    // 用户感知 Chat 1 突然变成 Chat 2 —— 追加保持老标签稳定）。
    const { result } = setup();
    act(() => result.current.dispatch({ type: 'set_chats', chats: [makeChat('a')] }));
    act(() =>
      result.current.dispatch({ type: 'add_chat', chat: makeChat('new'), setActive: true }),
    );
    expect(result.current.state.chats!.map((c) => c.id)).toEqual(['a', 'new']);
    expect(result.current.state.activeChatId).toBe('new');
  });

  it('add_chat without setActive keeps current activeChatId', () => {
    const { result } = setup();
    act(() => result.current.dispatch({ type: 'set_chats', chats: [makeChat('a')] }));
    act(() => result.current.dispatch({ type: 'add_chat', chat: makeChat('new') }));
    expect(result.current.state.chats!.length).toBe(2);
    expect(result.current.state.activeChatId).toBe('a');
  });

  it('rename_chat updates title only on the matching id', () => {
    const { result } = setup();
    act(() =>
      result.current.dispatch({
        type: 'set_chats',
        chats: [makeChat('a', 'Old'), makeChat('b', 'B')],
      }),
    );
    act(() => result.current.dispatch({ type: 'rename_chat', chatId: 'a', title: 'New' }));
    expect(result.current.state.chats!.find((c) => c.id === 'a')!.title).toBe('New');
    expect(result.current.state.chats!.find((c) => c.id === 'b')!.title).toBe('B');
  });

  it('remove_chat drops the row and reassigns active when needed', () => {
    const { result } = setup();
    act(() =>
      result.current.dispatch({
        type: 'set_chats',
        chats: [makeChat('a'), makeChat('b'), makeChat('c')],
        activeChatId: 'b',
      }),
    );
    act(() => result.current.dispatch({ type: 'remove_chat', chatId: 'b' }));
    expect(result.current.state.chats!.map((c) => c.id)).toEqual(['a', 'c']);
    expect(result.current.state.activeChatId).toBe('a');
  });

  it('remove_chat keeps active when removed chat is not active', () => {
    const { result } = setup();
    act(() =>
      result.current.dispatch({
        type: 'set_chats',
        chats: [makeChat('a'), makeChat('b')],
        activeChatId: 'a',
      }),
    );
    act(() => result.current.dispatch({ type: 'remove_chat', chatId: 'b' }));
    expect(result.current.state.activeChatId).toBe('a');
  });

  it('remove_chat sets activeChatId to null if list emptied', () => {
    const { result } = setup();
    act(() =>
      result.current.dispatch({
        type: 'set_chats',
        chats: [makeChat('only')],
        activeChatId: 'only',
      }),
    );
    act(() => result.current.dispatch({ type: 'remove_chat', chatId: 'only' }));
    expect(result.current.state.chats).toEqual([]);
    expect(result.current.state.activeChatId).toBeNull();
  });

  it('set_chats_error stashes error string', () => {
    const { result } = setup();
    act(() => result.current.dispatch({ type: 'set_chats_error', error: 'whoops' }));
    expect(result.current.state.chatsError).toBe('whoops');
  });
});

describe('workspace actions — chats CRUD', () => {
  it('createChat is now lazy — adds a pending placeholder, does NOT POST', async () => {
    // 行为更新 (2026-05-03 用户决定): 点 + 加号不再立即 POST /chats，改成在前端
    // state 加 isPending=true 占位；POST 推迟到 materializeChat（用户首发消息时）。
    const postCalls: unknown[][] = [];
    apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return new Promise(() => {});
      if (path.includes('/chats') && method === 'POST') {
        postCalls.push([path, init]);
        const body = JSON.parse(init?.body ?? '{}');
        return { chat: makeChat(body.id ?? 'srv-x', body.title ?? null) };
      }
      return undefined;
    });
    const { result } = setup();

    let returnedId = '';
    await act(async () => {
      returnedId = await result.current.actions.createChat('My new');
    });
    expect(returnedId).toBeTruthy();
    const placeholder = result.current.state.chats!.find((c) => c.id === returnedId);
    expect(placeholder).toBeDefined();
    expect(placeholder!.isPending).toBe(true);
    expect(result.current.state.activeChatId).toBe(returnedId);
    // 关键：还没 POST
    expect(postCalls.length).toBe(0);
  });

  it('materializeChat POSTs and clears isPending on the placeholder', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return new Promise(() => {});
      if (path.includes('/chats') && method === 'POST') {
        const body = JSON.parse(init?.body ?? '{}');
        return { chat: makeChat(body.id, body.title ?? null) };
      }
      return undefined;
    });
    const { result } = setup();

    let id = '';
    await act(async () => {
      id = await result.current.actions.createChat('New');
    });
    expect(result.current.state.chats!.find((c) => c.id === id)!.isPending).toBe(true);

    await act(async () => {
      await result.current.actions.materializeChat(id);
    });
    const after = result.current.state.chats!.find((c) => c.id === id)!;
    expect(after.isPending).toBe(false);
  });

  it('materializeChat throws if POST fails — caller (ChatPanel) blocks send', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return new Promise(() => {});
      if (path.includes('/chats') && method === 'POST') throw new Error('500');
      return undefined;
    });
    const { result } = setup();
    let id = '';
    await act(async () => {
      id = await result.current.actions.createChat();
    });
    let threw = false;
    await act(async () => {
      try {
        await result.current.actions.materializeChat(id);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(true);
    // 失败保留 placeholder（用户可重试发送 → 再次 materialize）
    expect(result.current.state.chats!.find((c) => c.id === id)?.isPending).toBe(true);
  });

  it('renameChat optimistic + PATCH', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return new Promise(() => {});
      if (path.includes('/chats/a') && method === 'PATCH') {
        const body = JSON.parse(init?.body ?? '{}');
        return { chat: makeChat('a', body.title) };
      }
      return undefined;
    });
    const { result } = setup();
    act(() => result.current.dispatch({ type: 'set_chats', chats: [makeChat('a', 'Old')] }));
    await act(async () => {
      await result.current.actions.renameChat('a', 'Renamed');
    });
    expect(result.current.state.chats![0]!.title).toBe('Renamed');
    const patch = apiMock.mock.calls.find(
      ([path, init]) =>
        path.includes('/chats/a') && (init as { method?: string })?.method === 'PATCH',
    );
    expect(patch).toBeDefined();
  });

  it('renameChat rolls back on PATCH failure', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return new Promise(() => {});
      if (path.includes('/chats/a') && method === 'PATCH') throw new Error('boom');
      return undefined;
    });
    const { result } = setup();
    act(() => result.current.dispatch({ type: 'set_chats', chats: [makeChat('a', 'Old')] }));
    await act(async () => {
      await result.current.actions.renameChat('a', 'Renamed').catch(() => {});
    });
    expect(result.current.state.chats![0]!.title).toBe('Old');
    await waitFor(() => expect(showToastMock).toHaveBeenCalled());
  });

  it('deleteChat optimistic + DELETE', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return new Promise(() => {});
      if (path.includes('/chats/a') && method === 'DELETE') return undefined;
      return undefined;
    });
    const { result } = setup();
    act(() =>
      result.current.dispatch({
        type: 'set_chats',
        chats: [makeChat('a'), makeChat('b')],
        activeChatId: 'a',
      }),
    );
    await act(async () => {
      await result.current.actions.deleteChat('a');
    });
    expect(result.current.state.chats!.map((c) => c.id)).toEqual(['b']);
    expect(result.current.state.activeChatId).toBe('b');
    const del = apiMock.mock.calls.find(
      ([path, init]) =>
        path.includes('/chats/a') && (init as { method?: string })?.method === 'DELETE',
    );
    expect(del).toBeDefined();
  });

  it('deleteChat rolls back on DELETE failure', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return new Promise(() => {});
      if (path.includes('/chats/a') && method === 'DELETE') throw new Error('boom');
      return undefined;
    });
    const { result } = setup();
    act(() =>
      result.current.dispatch({
        type: 'set_chats',
        chats: [makeChat('a'), makeChat('b')],
        activeChatId: 'a',
      }),
    );
    await act(async () => {
      await result.current.actions.deleteChat('a').catch(() => {});
    });
    // restored
    expect(result.current.state.chats!.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result.current.state.activeChatId).toBe('a');
    await waitFor(() => expect(showToastMock).toHaveBeenCalled());
  });
});

describe('workspace effects — chats hydration', () => {
  it('GET /chats success populates state.chats', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') {
        return { chats: [makeChat('a'), makeChat('b')] };
      }
      return new Promise(() => {});
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.state.chats).not.toBeNull());
    expect(result.current.state.chats!.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result.current.state.activeChatId).toBe('a');
  });

  it('GET /chats empty + POST creates a default first chat', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') return { chats: [] };
      if (path.includes('/chats') && method === 'POST') {
        return { chat: makeChat('lazy') };
      }
      return new Promise(() => {});
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.state.chats?.length).toBe(1));
    expect(result.current.state.activeChatId).toBe('lazy');
  });

  it('GET /chats failure surfaces chatsError', async () => {
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (path.includes('/chats') && method === 'GET') throw new Error('upstream');
      return new Promise(() => {});
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();
    await waitFor(() => expect(result.current.state.chatsError).toBe('upstream'));
    errSpy.mockRestore();
  });

  it('readOnly mode does not fetch chats', async () => {
    apiMock.mockImplementation(async () => ({ chats: [] }));
    setup('p1', /* readOnly */ true);
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock).not.toHaveBeenCalled();
  });
});
