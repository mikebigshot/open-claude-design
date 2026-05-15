// update_todos — operations-based delta protocol.
//
// Each call sends only the CHANGES (operations[]). The state machine resolves
// to the new full list; the tool_result echoes that list rendered so the LLM
// sees freshly assigned ids to reference next time. onUpdate keeps the React
// UI panel in sync per chat tab.

import { tool } from 'ai';
import { z } from 'zod';
import type { Todo } from '../todos-state.js';
import {
  applyOperations,
  getTodos,
  type UpdateTodoOperation,
} from '../lib/todos-state-machine.js';
import { renderTodos } from '../lib/render-todos.js';

const DESCRIPTION = `Track your task list. Use this tool whenever you have more than one discrete task to do, or whenever given a long-running or multi-step task. Call it early to lay out your plan, then call it again as you complete, add, or remove tasks.

Each call sends only the CHANGES to apply — a list of operations. The result echoes back the full current list with ids so you know what to reference next time.

Operations:
- add: create a new task (provide "name")
- complete: mark an existing task done (provide "id" from a previous result)
- remove: delete a task (provide "id")

Because this tool is just for you (and to show the user) you can call it and then immediately call an action in the same block, for speed. No need to wait.`;

const OperationSchema = z.object({
  type: z.enum(['add', 'remove', 'complete']).describe('Operation type'),
  name: z.string().optional().describe('Task description (required for "add").'),
  id: z.string().optional().describe('Id of an existing task (required for "remove" and "complete").'),
});

export interface UpdateTodosContext {
  getChatId: () => string;
  onUpdate: (todos: Todo[]) => void;
}

export function updateTodosTool(ctx: UpdateTodosContext) {
  return tool({
    description: DESCRIPTION,
    inputSchema: z
      .object({
        operations: z.array(OperationSchema).describe('Changes to apply to the todo list.'),
      })
      .strict(),
    execute: async ({ operations }) => {
      const chatId = ctx.getChatId();
      let updated: Todo[];
      try {
        updated = applyOperations(chatId, operations as UpdateTodoOperation[]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Echo current state alongside the error so the LLM can recover its
        // bearings (mirrors the official pattern of always returning a
        // useful state snapshot).
        const current = renderTodos(getTodos(chatId));
        return `Error: ${msg}\n\n${current}`;
      }
      ctx.onUpdate(updated);
      return renderTodos(updated);
    },
  });
}
