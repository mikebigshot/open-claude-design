import { tool } from 'ai';
import { z } from 'zod';
import type { Todo } from '../todos-state.js';

export interface UpdateTodosContext {
  onUpdate: (todos: Todo[]) => void;
}

export function updateTodosTool(ctx: UpdateTodosContext) {
  return tool({
    description:
      'Set or update the todo list shown in the right sidebar. Use to plan multi-step work and report progress. Pass the FULL list each time (replaces, not appends). Statuses: pending | in_progress | completed.',
    inputSchema: z.object({
      todos: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          status: z.enum(['pending', 'in_progress', 'completed']),
        }),
      ),
    }),
    execute: async ({ todos }) => {
      ctx.onUpdate(todos);
      return { ok: true as const };
    },
  });
}
