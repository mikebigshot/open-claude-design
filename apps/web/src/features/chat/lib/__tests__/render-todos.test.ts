// render-todos — formats the todo list as the string echoed back to the LLM
// in the `update_todos` tool_result.
//
// Also covers `renderTodoReminder()` — the `<todo_reminder>...</todo_reminder>`
// block injected via prepareStep when outstanding todos exist.

import { describe, expect, it } from 'vitest';
import { renderTodos, renderTodoReminder } from '../render-todos';
import type { Todo } from '../../todos-state.js';

const t = (id: string, content: string, completed = false): Todo => ({
  id,
  content,
  status: completed ? 'completed' : 'pending',
});

describe('renderTodos', () => {
  it('returns "Todo list is empty." for an empty list', () => {
    expect(renderTodos([])).toBe('Todo list is empty.');
  });

  it('prefixes with "Current todos:" and lists rows in <id>. [marker] <content> format', () => {
    const out = renderTodos([t('1', 'a'), t('2', 'b', true)]);
    expect(out).toBe('Current todos:\n1. [ ] a\n2. [x] b');
  });

  it('preserves insertion order', () => {
    const out = renderTodos([t('5', 'fifth'), t('1', 'first'), t('3', 'third')]);
    expect(out).toBe('Current todos:\n5. [ ] fifth\n1. [ ] first\n3. [ ] third');
  });

  it('handles a single completed item', () => {
    expect(renderTodos([t('7', 'done thing', true)])).toBe('Current todos:\n7. [x] done thing');
  });

  it('handles multi-word content without escaping', () => {
    expect(renderTodos([t('1', 'build the [thing] now')])).toContain('build the [thing] now');
  });
});

describe('renderTodoReminder', () => {
  it('returns null when the list is empty', () => {
    expect(renderTodoReminder([])).toBeNull();
  });

  it('returns null when all todos are completed', () => {
    expect(renderTodoReminder([t('1', 'a', true), t('2', 'b', true)])).toBeNull();
  });

  it('wraps outstanding todos in <todo_reminder> with leading newline + count', () => {
    const out = renderTodoReminder([t('1', 'a'), t('2', 'b', true), t('3', 'c')]);
    expect(out).toBe(
      '\n<todo_reminder>\nYou have 2 outstanding todo(s):\n  1. a\n  3. c\n</todo_reminder>',
    );
  });

  it('singular pluralization is acceptable as "todo(s)" matching official', () => {
    const out = renderTodoReminder([t('1', 'only one')]);
    expect(out).toContain('You have 1 outstanding todo(s)');
  });
});
