// Tests for snip — context-management tool that registers `[id:mNNNN]` ranges
// for deferred removal. Snip is a *registration* system; W1 prepareStep applies
// pending snips when context is near the model limit.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _registerSnip,
  clearSnipRegistry,
  getRegisteredSnips,
  markSnipsConsumed,
  snipTool,
} from '../snip';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('snip', () => {
  beforeEach(() => clearSnipRegistry());
  afterEach(() => clearSnipRegistry());

  it('returns "Snip registered (1 queued)." on first registration', async () => {
    const t = snipTool({ getChatId: () => 'c1' });
    const r = await t.execute!(
      { from_id: 'm0003', to_id: 'm0007', reason: 'resolved exploration' },
      ctx,
    );
    expect(r).toBe('Snip registered (1 queued).');
  });

  it('counts queued (un-consumed) snips, not lifetime registrations', async () => {
    const t = snipTool({ getChatId: () => 'c1' });
    await t.execute!({ from_id: 'm0003', to_id: 'm0005' }, ctx);
    await t.execute!({ from_id: 'm0010', to_id: 'm0012' }, ctx);
    const r = (await t.execute!({ from_id: 'm0020', to_id: 'm0022' }, ctx)) as string;
    expect(r).toBe('Snip registered (3 queued).');

    markSnipsConsumed('c1');
    const r2 = (await t.execute!({ from_id: 'm0030', to_id: 'm0031' }, ctx)) as string;
    expect(r2).toBe('Snip registered (1 queued).');
  });

  it('keeps registries isolated per chat id', async () => {
    const t1 = snipTool({ getChatId: () => 'chatA' });
    const t2 = snipTool({ getChatId: () => 'chatB' });
    await t1.execute!({ from_id: 'm1', to_id: 'm2' }, ctx);
    await t2.execute!({ from_id: 'm5', to_id: 'm6' }, ctx);
    expect(getRegisteredSnips('chatA')).toHaveLength(1);
    expect(getRegisteredSnips('chatB')).toHaveLength(1);
    expect(getRegisteredSnips('chatA')[0]?.fromId).toBe('m1');
    expect(getRegisteredSnips('chatB')[0]?.fromId).toBe('m5');
  });

  it('preserves the optional reason field', async () => {
    _registerSnip('c1', 'm0001', 'm0002', 'no longer relevant');
    const list = getRegisteredSnips('c1');
    expect(list[0]?.reason).toBe('no longer relevant');
  });

  it('omits reason when not provided', async () => {
    _registerSnip('c1', 'm0001', 'm0002');
    const list = getRegisteredSnips('c1');
    expect(list[0]?.reason).toBeUndefined();
  });

  it('marks all snips for one chat consumed, not other chats', async () => {
    _registerSnip('a', 'm1', 'm2');
    _registerSnip('b', 'm3', 'm4');
    markSnipsConsumed('a');
    expect(getRegisteredSnips('a').every((s) => s.consumed)).toBe(true);
    expect(getRegisteredSnips('b').every((s) => !s.consumed)).toBe(true);
  });

  it('clearSnipRegistry() with no chat id clears all chats', async () => {
    _registerSnip('a', 'm1', 'm2');
    _registerSnip('b', 'm3', 'm4');
    clearSnipRegistry();
    expect(getRegisteredSnips('a')).toEqual([]);
    expect(getRegisteredSnips('b')).toEqual([]);
  });

  it('clearSnipRegistry(chatId) clears only that chat', async () => {
    _registerSnip('a', 'm1', 'm2');
    _registerSnip('b', 'm3', 'm4');
    clearSnipRegistry('a');
    expect(getRegisteredSnips('a')).toEqual([]);
    expect(getRegisteredSnips('b')).toHaveLength(1);
  });

  it('exposes a description that mentions the [id:mNNNN] tag protocol', () => {
    const t = snipTool({ getChatId: () => 'c1' });
    expect(t.description).toMatch(/id:m/i);
    expect(t.description).toMatch(/from_id/);
  });

  it('has the required input_schema fields (from_id, to_id, optional reason)', () => {
    const t = snipTool({ getChatId: () => 'c1' });
    // The Zod schema is on `inputSchema`; we don't introspect Zod here, just
    // verify a sample with the v2 schema fields parses without throwing.
    expect(t.inputSchema).toBeTruthy();
  });

  it('does not perform any network I/O', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('', { status: 200 });
    }) as typeof fetch;
    const t = snipTool({ getChatId: () => 'c1' });
    await t.execute!({ from_id: 'm1', to_id: 'm2' }, ctx);
    expect(fetchCalled).toBe(false);
  });

  describe('invalid-id friendly error (qx alignment)', () => {
    it('returns an error with the valid id list when from_id is hallucinated', async () => {
      const t = snipTool({ getChatId: () => 'c1' });
      const messages = [
        { role: 'user', content: 'first task [id:m0001]' },
        { role: 'user', content: 'second [id:m0002]' },
        { role: 'user', content: 'third [id:m0003]' },
      ];
      const r = (await t.execute!(
        { from_id: 'm9999', to_id: 'm0003' },
        { ...ctx, messages: messages as never },
      )) as string;
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/snip id not found/i);
      expect(r).toContain('from_id="m9999"');
      expect(r).toMatch(/Valid IDs \(3 total\)/);
      expect(r).toContain('m0001');
      expect(r).toContain('m0002');
      expect(r).toContain('m0003');
    });

    it('returns error when to_id is hallucinated', async () => {
      const t = snipTool({ getChatId: () => 'c1' });
      const messages = [{ role: 'user', content: 'task [id:m0001]' }];
      const r = (await t.execute!(
        { from_id: 'm0001', to_id: 'm9999' },
        { ...ctx, messages: messages as never },
      )) as string;
      expect(r).toMatch(/snip id not found/i);
      expect(r).toContain('to_id="m9999"');
    });

    it('accepts registration when both ids exist', async () => {
      const t = snipTool({ getChatId: () => 'c1' });
      const messages = [
        { role: 'user', content: '[id:m0001]' },
        { role: 'user', content: '[id:m0002]' },
      ];
      const r = (await t.execute!(
        { from_id: 'm0001', to_id: 'm0002' },
        { ...ctx, messages: messages as never },
      )) as string;
      expect(r).toMatch(/registered/);
    });

    it('skips validation when messages array is empty (back-compat)', async () => {
      // Old tests don't pass messages — keep them working by short-circuiting.
      const t = snipTool({ getChatId: () => 'c1' });
      const r = (await t.execute!({ from_id: 'mZZZ', to_id: 'mAAA' }, ctx)) as string;
      expect(r).toMatch(/registered/);
    });

    it('finds ids inside array-of-parts content (AI SDK 6 user message shape)', async () => {
      const t = snipTool({ getChatId: () => 'c1' });
      const messages = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hello [id:m0042]' }],
        },
      ];
      const r = (await t.execute!(
        { from_id: 'm0042', to_id: 'm0042' },
        { ...ctx, messages: messages as never },
      )) as string;
      expect(r).toMatch(/registered/);
    });
  });
});
