// render-todos — format the todo list for echo-back into the `update_todos`
// tool_result, and produce the `<todo_reminder>` system-reminder block
// injected via prepareStep.
//
// Empty list → "Todo list is empty."
// Non-empty  → "Current todos:\n<id>. [x|space] <content>\n..."
//
// Outstanding-only reminder:
//   null when no pending items; otherwise
//   "\n<todo_reminder>\nYou have N outstanding todo(s):\n  <id>. <content>\n...\n</todo_reminder>"

import type { Todo } from '../todos-state.js';

function isCompleted(t: Todo): boolean {
  return t.status === 'completed';
}

export function renderTodos(todos: Todo[]): string {
  if (todos.length === 0) return 'Todo list is empty.';
  const rows = todos.map((t) => `${t.id}. [${isCompleted(t) ? 'x' : ' '}] ${t.content}`);
  return `Current todos:\n${rows.join('\n')}`;
}

export function renderTodoReminder(todos: Todo[]): string | null {
  const outstanding = todos.filter((t) => !isCompleted(t));
  if (outstanding.length === 0) return null;
  const rows = outstanding.map((t) => `  ${t.id}. ${t.content}`);
  return `\n<todo_reminder>\nYou have ${outstanding.length} outstanding todo(s):\n${rows.join('\n')}\n</todo_reminder>`;
}
