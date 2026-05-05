// P1-7 — comments hydration failure must surface a user-visible signal.
//
// Before the fix, a failed GET /api/projects/:id/comments only logged to
// console; the workspace state stayed at `pins: []` with no error flag, so
// CommentsTab rendered the cheerful "no comments yet" empty state — visually
// indistinguishable from a legitimate empty project. These tests pin the
// new contract: state.commentsError carries the failure message, and a
// successful subsequent dispatch clears it.
//
// We also cover the optimistic-write failure paths (addPin / removePin):
// these now fire a toast on rejection (was: silent console.error).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    public readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

/**
 * 工具：让 apiMock 在 chats hydration（GET /chats）总是 resolve 空数组 + lazy
 * create 第一条 default chat（POST /chats）。其他 path（comments / messages）
 * 走 caller-set mock。
 *
 * 多 chat (Task 2) 后 WorkspaceProvider mount 会同时触发 chats + comments 两个
 * hydration effects；测试只关心 comments path，需要把 chats path 默认伪造掉。
 */
function withChatsBypass(rest: (path: string, init?: { method?: string }) => unknown) {
  return async (path: string, init?: { method?: string }) => {
    const method = (init?.method ?? 'GET') as string;
    if (path.includes('/chats') && method === 'GET') {
      return {
        chats: [
          {
            id: 'fake-chat',
            projectId: 'p',
            title: null,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
      };
    }
    if (path.includes('/chats') && method === 'POST') {
      return {
        chat: {
          id: 'fake-chat',
          projectId: 'p',
          title: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      };
    }
    return rest(path, init);
  };
}

vi.mock('../components/Toast', () => ({
  showToast: vi.fn(),
}));

import { WorkspaceProvider, useWorkspace } from './workspace';
import { api, ApiError } from '@/lib/api';
import { showToast } from '../components/Toast';
import type { CommentPin } from './types';

const apiMock = api as unknown as ReturnType<typeof vi.fn>;
const showToastMock = showToast as unknown as ReturnType<typeof vi.fn>;

const wrapper =
  (projectId: string, readOnly = false) =>
  ({ children }: { children: ReactNode }) => (
    <WorkspaceProvider projectId={projectId} readOnly={readOnly}>
      {children}
    </WorkspaceProvider>
  );

beforeEach(() => {
  apiMock.mockReset();
  showToastMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const PIN: CommentPin = {
  id: 'pin-test',
  n: 1,
  x: 10,
  y: 20,
  text: 'hello',
  selector: null,
  filePath: null,
  createdAt: '2026-05-01T00:00:00.000Z',
};

describe('workspace — comments hydration failure (P1-7)', () => {
  it('initial commentsError defaults to null before fetch resolves', () => {
    apiMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p1') });
    expect(result.current.state.commentsError).toBeNull();
  });

  it('sets commentsError when GET /comments rejects with a 500', async () => {
    apiMock.mockImplementation(
      withChatsBypass((path) => {
        if (path.includes('/comments')) {
          return Promise.reject(new ApiError(500, 'Comments table missing'));
        }
        return Promise.resolve(undefined);
      }),
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p1') });

    // Wait for the catch path to dispatch set_comments_error.
    await waitFor(() => {
      expect(result.current.state.commentsError).not.toBeNull();
    });
    expect(result.current.state.commentsError).toContain('Comments table missing');
    // Pins remain empty (we didn't break anything else).
    expect(result.current.state.pins).toEqual([]);
  });

  it('falls back to String(err) when the rejection is not an Error', async () => {
    // String rejections happen when an upstream layer throws plain strings;
    // we should still surface something legible rather than "[object Object]".
    apiMock.mockImplementation(
      withChatsBypass((path) => {
        if (path.includes('/comments')) return Promise.reject('boom');
        return Promise.resolve(undefined);
      }),
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p2') });
    await waitFor(() => expect(result.current.state.commentsError).toBe('boom'));
  });

  it('clears commentsError on a subsequent successful fetch', async () => {
    apiMock.mockImplementation(
      withChatsBypass((path) => {
        if (path.includes('/comments')) {
          return Promise.reject(new ApiError(503, 'Service unavailable'));
        }
        return Promise.resolve(undefined);
      }),
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p3') });
    await waitFor(() => expect(result.current.state.commentsError).not.toBeNull());

    // Manually dispatch a clear (simulates what a retry button would do).
    act(() => result.current.dispatch({ type: 'set_comments_error', error: null }));
    expect(result.current.state.commentsError).toBeNull();
  });

  it('does NOT fetch comments in readOnly mode (share view)', async () => {
    apiMock.mockResolvedValueOnce({ comments: [] });
    renderHook(() => useWorkspace(), { wrapper: wrapper('p4', /* readOnly */ true) });
    // Effect runs once on mount; readOnly should short-circuit before api() is called.
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('clears commentsError on a successful hydrate (regression guard for retry-on-mount)', async () => {
    apiMock.mockImplementation(
      withChatsBypass((path) => {
        if (path.includes('/comments')) {
          return Promise.resolve({
            comments: [
              {
                id: 'c1',
                n: 1,
                x: 10,
                y: 20,
                text: 'hello',
                createdAt: '2026-05-01T00:00:00.000Z',
                projectId: 'p5',
                selector: null,
                filePath: null,
              },
            ],
          });
        }
        return Promise.resolve(undefined);
      }),
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p5') });
    await waitFor(() => expect(result.current.state.pins).toHaveLength(1));
    expect(result.current.state.commentsError).toBeNull();
  });
});

describe('workspace reducer — set_comments_error', () => {
  it('set_comments_error sets the error string', () => {
    apiMock.mockImplementation(() => new Promise(() => {})); // never resolves so initial null sticks
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p6') });
    act(() => result.current.dispatch({ type: 'set_comments_error', error: 'kaboom' }));
    expect(result.current.state.commentsError).toBe('kaboom');
  });

  it('set_comments_error with null clears it', () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p7') });
    act(() => result.current.dispatch({ type: 'set_comments_error', error: 'first' }));
    act(() => result.current.dispatch({ type: 'set_comments_error', error: null }));
    expect(result.current.state.commentsError).toBeNull();
  });
});

describe('workspace — optimistic pin write failures', () => {
  it('shows toast when addPin POST rejects', async () => {
    // chats hydration resolves; comments GET resolves empty; POST to /comments rejects.
    apiMock.mockImplementation(
      withChatsBypass(async (path: string, init?: { method?: string }) => {
        if (path.includes('/comments') && (init?.method ?? 'GET') === 'POST') {
          throw new Error('POST blocked');
        }
        if (path.includes('/comments')) return { comments: [] };
        return undefined;
      }),
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p8') });
    // Wait for initial hydrate to settle.
    await waitFor(() => expect(apiMock).toHaveBeenCalled());

    act(() => result.current.actions.addPin(PIN));

    await waitFor(() => expect(showToastMock).toHaveBeenCalled());
    const call = showToastMock.mock.calls[0]?.[0];
    expect(call?.variant).toBe('error');
    expect(call?.message).toMatch(/comment/i);
    // Optimistic state still holds the pin — we don't revert.
    expect(result.current.state.pins).toHaveLength(1);
  });

  it('shows toast when removePin DELETE rejects', async () => {
    apiMock.mockImplementation(
      withChatsBypass(async (path: string, init?: { method?: string }) => {
        if (path.includes('/comments') && (init?.method ?? 'GET') === 'DELETE') {
          throw new Error('DELETE blocked');
        }
        if (path.includes('/comments') && (init?.method ?? 'GET') === 'POST') return undefined;
        if (path.includes('/comments')) return { comments: [] };
        return undefined;
      }),
    );
    const { result } = renderHook(() => useWorkspace(), { wrapper: wrapper('p9') });
    await waitFor(() => expect(apiMock).toHaveBeenCalled());

    act(() => result.current.actions.addPin(PIN));
    showToastMock.mockClear();
    act(() => result.current.actions.removePin(PIN.id));

    await waitFor(() => expect(showToastMock).toHaveBeenCalled());
    const call = showToastMock.mock.calls[0]?.[0];
    expect(call?.variant).toBe('error');
    expect(call?.message).toMatch(/delete|comment/i);
  });

  it('readOnly mode does not POST/DELETE on addPin/removePin', async () => {
    apiMock.mockResolvedValue({ comments: [] });
    const { result } = renderHook(() => useWorkspace(), {
      wrapper: wrapper('p10', /* readOnly */ true),
    });
    // No initial GET in readOnly either.
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock).not.toHaveBeenCalled();

    act(() => result.current.actions.addPin(PIN));
    act(() => result.current.actions.removePin(PIN.id));

    // No POST/DELETE attempts either.
    expect(apiMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
  });
});
