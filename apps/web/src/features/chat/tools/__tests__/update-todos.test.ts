// update_todos — operations-diff protocol.
//
// Input: `{operations: [{type:'add'|'remove'|'complete', name?, id?}]}` applied
// as deltas against per-chat state. The tool_result is the rendered list so
// the LLM can reference the freshly assigned ids next time. onUpdate keeps the
// React UI panel in sync.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateTodosTool } from '../update-todos';
import { _resetTodosStateMachine, getTodos } from '../../lib/todos-state-machine';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

beforeEach(() => _resetTodosStateMachine());
afterEach(() => _resetTodosStateMachine());

describe('update_todos', () => {
  describe('schema', () => {
    it('description mentions operations / add / complete / remove', () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      const desc = String(t.description);
      expect(desc.toLowerCase()).toMatch(/operation/);
      expect(desc.toLowerCase()).toMatch(/add/);
      expect(desc.toLowerCase()).toMatch(/complete/);
      expect(desc.toLowerCase()).toMatch(/remove/);
    });

    it('accepts an operations array', () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      expect(
        asSchema(t.inputSchema)?.safeParse({ operations: [{ type: 'add', name: 'foo' }] }).success,
      ).toBe(true);
    });

    it('accepts an empty operations array (echo-only)', () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      expect(asSchema(t.inputSchema)?.safeParse({ operations: [] }).success).toBe(true);
    });

    it('rejects the old {todos} shape', () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      expect(
        asSchema(t.inputSchema)?.safeParse({ todos: [{ id: '1', content: 'a', status: 'pending' }] })
          .success,
      ).toBe(false);
    });

    it('rejects an operation with no type', () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      expect(asSchema(t.inputSchema)?.safeParse({ operations: [{ name: 'x' }] }).success).toBe(false);
    });

    it('rejects an operation with an unknown type', () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      expect(
        asSchema(t.inputSchema)?.safeParse({ operations: [{ type: 'unknownop', name: 'x' }] }).success,
      ).toBe(false);
    });
  });

  describe('add', () => {
    it('echoes back the rendered list with the new todo', async () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      const r = (await t.execute!({ operations: [{ type: 'add', name: 'Build page' }] }, ctx)) as string;
      expect(typeof r).toBe('string');
      expect(r).toContain('Current todos:');
      expect(r).toContain('[ ] Build page');
    });

    it('calls onUpdate with the updated todos array', async () => {
      const onUpdate = vi.fn();
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate });
      await t.execute!({ operations: [{ type: 'add', name: 'a' }] }, ctx);
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const arg = onUpdate.mock.calls[0]![0];
      expect(arg).toHaveLength(1);
      expect(arg[0].content).toBe('a');
      expect(arg[0].status).toBe('pending');
    });

    it('returns the error string when name is missing (no throw)', async () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      const r = (await t.execute!({ operations: [{ type: 'add' }] }, ctx)) as string;
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/name/i);
    });
  });

  describe('complete', () => {
    it('echoes back with the [x] marker on the completed row', async () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      await t.execute!({ operations: [{ type: 'add', name: 'a' }] }, ctx);
      const id = getTodos('c1')[0]!.id;

      const r = (await t.execute!({ operations: [{ type: 'complete', id }] }, ctx)) as string;
      expect(r).toContain(`[x] a`);
    });

    it('returns error string when id does not exist', async () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      const r = (await t.execute!({ operations: [{ type: 'complete', id: 'fake' }] }, ctx)) as string;
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/not found|unknown|no such/i);
    });
  });

  describe('remove', () => {
    it('drops the todo and echoes the remaining list', async () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      await t.execute!(
        { operations: [{ type: 'add', name: 'a' }, { type: 'add', name: 'b' }] },
        ctx,
      );
      const ids = getTodos('c1').map((x) => x.id);
      const r = (await t.execute!({ operations: [{ type: 'remove', id: ids[0]! }] }, ctx)) as string;
      expect(r).not.toContain('] a');
      expect(r).toContain('] b');
    });
  });

  describe('echo with no operations', () => {
    it('returns "Todo list is empty." when there are no todos', async () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      const r = (await t.execute!({ operations: [] }, ctx)) as string;
      expect(r).toBe('Todo list is empty.');
    });

    it('returns the current list when operations is empty and state exists', async () => {
      const t = updateTodosTool({ getChatId: () => 'c1', onUpdate: () => {} });
      await t.execute!({ operations: [{ type: 'add', name: 'a' }] }, ctx);
      const r = (await t.execute!({ operations: [] }, ctx)) as string;
      expect(r).toContain('[ ] a');
    });
  });

  describe('per-chat isolation', () => {
    it('does not leak state across chat ids', async () => {
      const tA = updateTodosTool({ getChatId: () => 'chat-A', onUpdate: () => {} });
      const tB = updateTodosTool({ getChatId: () => 'chat-B', onUpdate: () => {} });
      await tA.execute!({ operations: [{ type: 'add', name: 'in A' }] }, ctx);
      const rB = (await tB.execute!({ operations: [] }, ctx)) as string;
      expect(rB).toBe('Todo list is empty.');
    });
  });
});
