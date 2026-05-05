import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TodosProvider, useTodos } from '../todos-state';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <TodosProvider>{children}</TodosProvider>
);

describe('todos-state', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useTodos(), { wrapper });
    expect(result.current.todos).toEqual([]);
  });
  it('replaces todos via setAll', () => {
    const { result } = renderHook(() => useTodos(), { wrapper });
    act(() => result.current.setAll([{ id: '1', content: 'do it', status: 'pending' }]));
    expect(result.current.todos).toEqual([{ id: '1', content: 'do it', status: 'pending' }]);
  });
  it('returns no-op fallback when used outside provider', () => {
    const { result } = renderHook(() => useTodos());
    expect(result.current.todos).toEqual([]);
    // Should not throw:
    result.current.setAll([{ id: '1', content: 'x', status: 'pending' }]);
  });
});
