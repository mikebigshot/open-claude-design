import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface Todo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodosCtx {
  todos: Todo[];
  setAll: (todos: Todo[]) => void;
}

const Ctx = createContext<TodosCtx | null>(null);

export function TodosProvider({ children }: { children: ReactNode }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const setAll = useCallback((next: Todo[]) => setTodos(next), []);
  const value = useMemo(() => ({ todos, setAll }), [todos, setAll]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTodos(): TodosCtx {
  const v = useContext(Ctx);
  if (!v) {
    // Allow use outside a TodosProvider (interim until T26 mounts the provider).
    return { todos: [], setAll: () => {} };
  }
  return v;
}
