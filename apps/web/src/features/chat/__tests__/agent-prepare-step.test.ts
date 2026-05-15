// W1 §2.1 + §4.2 — prepareStep integration: when the running token estimate
// of the next step's messages exceeds `threshold`, the prepareStep callback
// (a) applies any registered snips, and (b) injects the v2
// `<system-reminder>` nudge into the most recent user message so the LLM
// is informed of context pressure.
//
// The actual ToolLoopAgent + LLM call is hard to spin up in vitest without
// a real provider, so we test `makePrepareStep` in isolation: it's a pure
// factory taking a snip getter + threshold and returning a PrepareStep
// callback. The callback returns either undefined (pass-through) or
// `{ messages: prunedMessages }` to override.

import { describe, expect, it, vi } from 'vitest';
import { makePrepareStep } from '../agent-prepare-step';
import type { Todo } from '../todos-state';

function userMsg(text: string): { role: 'user'; content: string } {
  return { role: 'user', content: text };
}

const REMINDER_PREFIX = '<system-reminder>';

describe('makePrepareStep (§2.1 snip threshold + §4.2 system-reminder)', () => {
  it('returns undefined when the estimated tokens are below threshold', async () => {
    const getSnips = vi.fn(() => []);
    const prepare = makePrepareStep({
      getRegisteredSnips: getSnips,
      threshold: 100, // way too high to ever trip
    });
    const result = await prepare({
      messages: [userMsg('hi [id:m0001]')],
      stepNumber: 0,
      // Other fields are unused by our impl; cast through unknown to satisfy
      // the AI SDK PrepareStep signature.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(result).toBeUndefined();
    // Doesn't ask for snips when the threshold isn't crossed.
    expect(getSnips).not.toHaveBeenCalled();
  });

  it('applies snips AND injects the system-reminder when over threshold', async () => {
    const getSnips = vi.fn(() => [{ from: 'm0001', to: 'm0001', reason: 'auto' }]);
    const prepare = makePrepareStep({
      getRegisteredSnips: getSnips,
      threshold: 1, // any non-zero estimate trips
    });
    const messages = [
      userMsg('first [id:m0001]'),
      { role: 'assistant' as const, content: 'first reply' },
      userMsg('second [id:m0002]'),
    ];
    const result = await prepare({
      messages,
      stepNumber: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(getSnips).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result?.messages).toBeDefined();
    // m0001 + the assistant reply that followed it are snipped → only the
    // m0002 user message remains. The system-reminder is then prepended
    // to its content.
    expect(result!.messages!.length).toBe(1);
    const content = (result!.messages![0] as { content: string }).content;
    expect(content).toContain(REMINDER_PREFIX);
    expect(content).toContain('second [id:m0002]');
  });

  it('still injects the system-reminder when getRegisteredSnips returns []', async () => {
    const getSnips = vi.fn(() => []);
    const prepare = makePrepareStep({
      getRegisteredSnips: getSnips,
      threshold: 1,
    });
    const result = await prepare({
      messages: [userMsg('first [id:m0001]')],
      stepNumber: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(getSnips).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    const content = (result!.messages![0] as { content: string }).content;
    expect(content).toContain(REMINDER_PREFIX);
    expect(content).toContain('first [id:m0001]');
  });

  it('still injects the system-reminder when getRegisteredSnips is not provided (W2 stub)', async () => {
    const prepare = makePrepareStep({
      threshold: 1,
      // No getRegisteredSnips
    });
    const result = await prepare({
      messages: [userMsg('a [id:m0001]')],
      stepNumber: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(result).toBeDefined();
    const content = (result!.messages![0] as { content: string }).content;
    expect(content).toContain(REMINDER_PREFIX);
    expect(content).toContain('a [id:m0001]');
  });

  it('still injects the system-reminder when no snip range matches the registered ids', async () => {
    const getSnips = vi.fn(() => [{ from: 'm9999', to: 'm9999' }]); // doesn't exist
    const prepare = makePrepareStep({
      getRegisteredSnips: getSnips,
      threshold: 1,
    });
    const result = await prepare({
      messages: [userMsg('first [id:m0001]')],
      stepNumber: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // No snips applied — but reminder still gets injected on the lone
    // user message because we crossed the threshold.
    expect(result).toBeDefined();
    expect(result!.messages!.length).toBe(1);
    const content = (result!.messages![0] as { content: string }).content;
    expect(content).toContain(REMINDER_PREFIX);
  });
});

// Aligns with the official `pq()` step-prepare function reverse-engineered
// from the production bundle: the agent loop injects a `<todo_reminder>`
// into the next user message whenever the chat has outstanding (uncompleted)
// todos. This is independent of token threshold — the reminder fires every
// step until the todos are completed or removed.
describe('makePrepareStep — <todo_reminder> injection (pq alignment)', () => {
  const pending = (id: string, content: string): Todo => ({ id, content, status: 'pending' });
  const completed = (id: string, content: string): Todo => ({
    id,
    content,
    status: 'completed',
  });

  it('returns undefined when there are no todos AND under threshold', async () => {
    const prepare = makePrepareStep({
      getCurrentTodos: () => [],
      threshold: 1_000_000,
    });
    const result = await prepare({
      messages: [userMsg('hi')],
      stepNumber: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(result).toBeUndefined();
  });

  it('returns undefined when all todos are completed (no outstanding)', async () => {
    const prepare = makePrepareStep({
      getCurrentTodos: () => [completed('1', 'done it')],
      threshold: 1_000_000,
    });
    const result = await prepare({
      messages: [userMsg('hi')],
      stepNumber: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(result).toBeUndefined();
  });

  it('injects <todo_reminder> when outstanding todos exist, even under threshold', async () => {
    const prepare = makePrepareStep({
      getCurrentTodos: () => [pending('1', 'build page'), pending('2', 'add header')],
      threshold: 1_000_000,
    });
    const result = await prepare({
      messages: [userMsg('finish up')],
      stepNumber: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(result).toBeDefined();
    const content = (result!.messages![0] as { content: string }).content;
    expect(content).toContain('<todo_reminder>');
    expect(content).toContain('You have 2 outstanding todo(s)');
    expect(content).toContain('  1. build page');
    expect(content).toContain('  2. add header');
    expect(content).toContain('</todo_reminder>');
    expect(content).toContain('finish up'); // original text preserved
  });

  it('combines <todo_reminder> with the token-pressure <system-reminder> when over threshold', async () => {
    const prepare = makePrepareStep({
      getRegisteredSnips: () => [],
      getCurrentTodos: () => [pending('1', 'open todo')],
      threshold: 1,
    });
    const result = await prepare({
      messages: [userMsg('working [id:m0001]')],
      stepNumber: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(result).toBeDefined();
    const content = (result!.messages![0] as { content: string }).content;
    expect(content).toContain('<system-reminder>');
    expect(content).toContain('<todo_reminder>');
    expect(content).toContain('open todo');
  });
});
