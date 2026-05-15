// todos-state-machine — per-chat operations log applied against a Map<chatId,
// Todo[]>. Mirrors the official update_todos `Aq(operations)` → `hq(chatId,
// ops)` flow (research v2 artifacts/tool-implementations/update_todos.js):
// operations are deltas (add/remove/complete), not full replacements.

import { afterEach, describe, expect, it } from 'vitest';
import {
  applyOperations,
  getTodos,
  clearTodos,
  _resetTodosStateMachine,
} from '../todos-state-machine';

describe('todos-state-machine', () => {
  afterEach(() => _resetTodosStateMachine());

  it('starts empty for any chatId', () => {
    expect(getTodos('chat-A')).toEqual([]);
  });

  describe('add operation', () => {
    it('appends a todo with auto-generated id and pending status', () => {
      const after = applyOperations('chat-A', [{ type: 'add', name: 'Build landing page' }]);
      expect(after).toHaveLength(1);
      expect(after[0]!.content).toBe('Build landing page');
      expect(after[0]!.status).toBe('pending');
      expect(after[0]!.id).toBeTruthy();
      expect(typeof after[0]!.id).toBe('string');
    });

    it('assigns unique ids across multiple adds', () => {
      const after = applyOperations('chat-A', [
        { type: 'add', name: 'task 1' },
        { type: 'add', name: 'task 2' },
        { type: 'add', name: 'task 3' },
      ]);
      expect(after).toHaveLength(3);
      const ids = after.map((t) => t.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('preserves insertion order', () => {
      const after = applyOperations('chat-A', [
        { type: 'add', name: 'first' },
        { type: 'add', name: 'second' },
        { type: 'add', name: 'third' },
      ]);
      expect(after.map((t) => t.content)).toEqual(['first', 'second', 'third']);
    });

    it('throws when `name` is missing', () => {
      expect(() => applyOperations('chat-A', [{ type: 'add' }])).toThrow(/name/i);
    });

    it('throws when `name` is empty after trim', () => {
      expect(() => applyOperations('chat-A', [{ type: 'add', name: '   ' }])).toThrow();
    });
  });

  describe('complete operation', () => {
    it('flips status to completed for the matching id', () => {
      applyOperations('chat-A', [
        { type: 'add', name: 'a' },
        { type: 'add', name: 'b' },
      ]);
      const ids = getTodos('chat-A').map((t) => t.id);
      const after = applyOperations('chat-A', [{ type: 'complete', id: ids[0]! }]);
      expect(after[0]!.status).toBe('completed');
      expect(after[1]!.status).toBe('pending');
    });

    it('is idempotent — completing twice leaves status completed', () => {
      applyOperations('chat-A', [{ type: 'add', name: 'a' }]);
      const id = getTodos('chat-A')[0]!.id;
      applyOperations('chat-A', [{ type: 'complete', id }]);
      const after = applyOperations('chat-A', [{ type: 'complete', id }]);
      expect(after[0]!.status).toBe('completed');
    });

    it('throws when `id` is missing', () => {
      applyOperations('chat-A', [{ type: 'add', name: 'a' }]);
      expect(() => applyOperations('chat-A', [{ type: 'complete' }])).toThrow(/id/i);
    });

    it('throws when `id` does not match any todo', () => {
      expect(() => applyOperations('chat-A', [{ type: 'complete', id: 'nonexistent' }])).toThrow(
        /not found|unknown|no such/i,
      );
    });
  });

  describe('remove operation', () => {
    it('drops the todo with the matching id', () => {
      applyOperations('chat-A', [
        { type: 'add', name: 'a' },
        { type: 'add', name: 'b' },
        { type: 'add', name: 'c' },
      ]);
      const ids = getTodos('chat-A').map((t) => t.id);
      const after = applyOperations('chat-A', [{ type: 'remove', id: ids[1]! }]);
      expect(after).toHaveLength(2);
      expect(after.map((t) => t.content)).toEqual(['a', 'c']);
    });

    it('throws when `id` is missing', () => {
      expect(() => applyOperations('chat-A', [{ type: 'remove' }])).toThrow(/id/i);
    });

    it('throws when `id` does not match any todo', () => {
      expect(() => applyOperations('chat-A', [{ type: 'remove', id: 'nope' }])).toThrow(
        /not found|unknown|no such/i,
      );
    });
  });

  describe('mixed operations in one call', () => {
    it('applies a batch of add/complete/remove sequentially', () => {
      applyOperations('chat-A', [{ type: 'add', name: 'seed' }]);
      const seedId = getTodos('chat-A')[0]!.id;

      const after = applyOperations('chat-A', [
        { type: 'add', name: 'second' },
        { type: 'complete', id: seedId },
        { type: 'add', name: 'third' },
      ]);

      expect(after).toHaveLength(3);
      expect(after[0]!.content).toBe('seed');
      expect(after[0]!.status).toBe('completed');
      expect(after[1]!.content).toBe('second');
      expect(after[2]!.content).toBe('third');
    });
  });

  describe('isolation across chatIds', () => {
    it('keeps separate todo lists per chat', () => {
      applyOperations('chat-A', [{ type: 'add', name: 'A item' }]);
      applyOperations('chat-B', [{ type: 'add', name: 'B item' }]);
      expect(getTodos('chat-A').map((t) => t.content)).toEqual(['A item']);
      expect(getTodos('chat-B').map((t) => t.content)).toEqual(['B item']);
    });
  });

  describe('clearTodos / _resetTodosStateMachine', () => {
    it('clearTodos wipes a single chat only', () => {
      applyOperations('chat-A', [{ type: 'add', name: 'a' }]);
      applyOperations('chat-B', [{ type: 'add', name: 'b' }]);
      clearTodos('chat-A');
      expect(getTodos('chat-A')).toEqual([]);
      expect(getTodos('chat-B')).toHaveLength(1);
    });

    it('_resetTodosStateMachine wipes everything (test hook)', () => {
      applyOperations('chat-A', [{ type: 'add', name: 'a' }]);
      applyOperations('chat-B', [{ type: 'add', name: 'b' }]);
      _resetTodosStateMachine();
      expect(getTodos('chat-A')).toEqual([]);
      expect(getTodos('chat-B')).toEqual([]);
    });
  });
});
