// todos-state-machine — per-chat operations log applied against module-level
// `Map<chatId, Todo[]>`. Each `update_todos` call is a delta, the state
// machine resolves to the new full list, and the renderer produces the
// echo-back string for the LLM.
//
// Operations:
//   - `add` (name): create a new todo, status='pending', auto-generated id
//   - `complete` (id): flip a todo's status to 'completed'
//   - `remove` (id): delete a todo
//
// Why a Map keyed by chatId? Multi-chat sessions: each chat tab has its own
// agent loop and its own todo list — chat A's items must not leak into chat
// B. Mirrors the official Tb/registry pattern.

import type { Todo } from '../todos-state.js';

export type UpdateTodoOperation =
  | { type: 'add'; name?: string; id?: never }
  | { type: 'complete'; id?: string; name?: never }
  | { type: 'remove'; id?: string; name?: never };

const state = new Map<string, Todo[]>();

let nextIdCounter = 0;
function makeId(): string {
  nextIdCounter += 1;
  return `todo_${Date.now().toString(36)}_${nextIdCounter.toString(36)}`;
}

function listFor(chatId: string): Todo[] {
  let list = state.get(chatId);
  if (!list) {
    list = [];
    state.set(chatId, list);
  }
  return list;
}

export function getTodos(chatId: string): Todo[] {
  return [...(state.get(chatId) ?? [])];
}

export function applyOperations(chatId: string, ops: UpdateTodoOperation[]): Todo[] {
  const list = listFor(chatId);
  for (const op of ops) {
    if (op.type === 'add') {
      const name = (op.name ?? '').trim();
      if (!name) {
        throw new Error('update_todos: `add` requires a non-empty `name`.');
      }
      list.push({ id: makeId(), content: name, status: 'pending' });
      continue;
    }
    if (op.type === 'complete') {
      const id = op.id?.trim();
      if (!id) {
        throw new Error('update_todos: `complete` requires an `id`.');
      }
      const idx = list.findIndex((t) => t.id === id);
      if (idx < 0) {
        throw new Error(`update_todos: \`complete\` id not found: ${id}`);
      }
      list[idx] = { ...list[idx]!, status: 'completed' };
      continue;
    }
    if (op.type === 'remove') {
      const id = op.id?.trim();
      if (!id) {
        throw new Error('update_todos: `remove` requires an `id`.');
      }
      const idx = list.findIndex((t) => t.id === id);
      if (idx < 0) {
        throw new Error(`update_todos: \`remove\` id not found: ${id}`);
      }
      list.splice(idx, 1);
      continue;
    }
    // exhaustive: TypeScript catches new op types at compile time
    throw new Error(`update_todos: unknown operation type ${(op as { type: string }).type}`);
  }
  return [...list];
}

export function clearTodos(chatId: string): void {
  state.delete(chatId);
}

/** Test-only hook. Wipes all state. */
export function _resetTodosStateMachine(): void {
  state.clear();
  nextIdCounter = 0;
}
