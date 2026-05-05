import { describe, expect, it, vi } from 'vitest';
import { updateTodosTool } from '../update-todos';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('update_todos', () => {
  it('calls onUpdate with the supplied todos and returns ok', async () => {
    const onUpdate = vi.fn();
    const t = updateTodosTool({ onUpdate });
    const r = await t.execute!({ todos: [{ id: '1', content: 'a', status: 'pending' }] }, ctx);
    expect(onUpdate).toHaveBeenCalledWith([{ id: '1', content: 'a', status: 'pending' }]);
    expect(r).toEqual({ ok: true });
  });
});
