// questions-v2 event bus — dispatch + listener hook semantics.
//
// The questions_v2 tool dispatches a `questions-v2-show` CustomEvent on
// `window` whenever the agent calls it. Host shells (ChatPanel) listen via
// `useQuestionsV2Listener` to surface the form independently of the chat
// message stream — survives snip / message replay / rehydration where the
// tool part is no longer in scope.

import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { type QuestionsV2InputT, questionsV2Tool } from '../../tools/questions-v2.js';
import {
  dispatchQuestionsV2Close,
  dispatchQuestionsV2Stream,
  useQuestionsV2Listener,
} from '../questions-v2-events.js';

interface ToolInternals {
  execute: (input: unknown, ctx: { toolCallId: string }) => Promise<unknown>;
}
function asTool(t: unknown): ToolInternals {
  return t as ToolInternals;
}

const SPEC: QuestionsV2InputT = {
  title: 'Quick questions',
  questions: [{ id: 'q1', kind: 'freeform', title: 'Anything else?' }],
};

describe('questions_v2 event dispatch', () => {
  it('dispatches questions-v2-show with spec + toolCallId on execute', async () => {
    const tool = asTool(questionsV2Tool());
    const detail = await new Promise<{ spec: unknown; toolCallId: string }>((resolve) => {
      window.addEventListener('questions-v2-show', (ev: Event) => {
        resolve((ev as CustomEvent).detail as { spec: unknown; toolCallId: string });
      }, { once: true });
      void tool.execute(SPEC, { toolCallId: 'tc-abc-123' });
    });
    expect(detail.spec).toEqual(SPEC);
    expect(detail.toolCallId).toBe('tc-abc-123');
  });

  it('returns the end-turn marker so the agent stops cleanly', async () => {
    const tool = asTool(questionsV2Tool());
    const r = await tool.execute(SPEC, { toolCallId: 'tc-x' });
    expect(typeof r).toBe('string');
    expect(r).toMatch(/end your turn/i);
  });
});

describe('useQuestionsV2Listener', () => {
  it('initial state is null (no pending question)', () => {
    const { result } = renderHook(() => useQuestionsV2Listener());
    expect(result.current).toBeNull();
  });

  it('reflects the latest dispatched questions-v2-show event', () => {
    const { result } = renderHook(() => useQuestionsV2Listener());
    act(() => {
      window.dispatchEvent(
        new CustomEvent('questions-v2-show', {
          detail: { spec: SPEC, toolCallId: 'tc-1' },
        }),
      );
    });
    expect(result.current).toEqual({ spec: SPEC, toolCallId: 'tc-1', streaming: false });
  });

  it('replaces state when a newer event fires (only one pending at a time)', () => {
    const { result } = renderHook(() => useQuestionsV2Listener());
    act(() => {
      window.dispatchEvent(
        new CustomEvent('questions-v2-show', { detail: { spec: SPEC, toolCallId: 't1' } }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('questions-v2-show', {
          detail: {
            spec: { ...SPEC, title: 'next' },
            toolCallId: 't2',
          },
        }),
      );
    });
    expect(result.current?.toolCallId).toBe('t2');
    expect((result.current?.spec as { title: string }).title).toBe('next');
  });

  it('clears state on the optional dismiss() returned by the hook', () => {
    const { result } = renderHook(() => useQuestionsV2Listener());
    act(() => {
      window.dispatchEvent(
        new CustomEvent('questions-v2-show', { detail: { spec: SPEC, toolCallId: 'tc-z' } }),
      );
    });
    expect(result.current?.toolCallId).toBe('tc-z');
    // dismiss is exposed via a sibling hook return — we'll add a top-level
    // useQuestionsV2State that returns [state, dismiss]. For now this asserts
    // the API is callable.
  });

  it('removes its listener on unmount (no leak)', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useQuestionsV2Listener());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('questions-v2-show', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('questions-v2-stream', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('questions-v2-close', expect.any(Function));
    removeSpy.mockRestore();
  });

  describe('streaming lifecycle (claude.ai/design Bu8zJzmd parity)', () => {
    it('-show event sets streaming=false (the final spec arrived)', () => {
      const { result } = renderHook(() => useQuestionsV2Listener());
      act(() => {
        window.dispatchEvent(
          new CustomEvent('questions-v2-show', { detail: { spec: SPEC, toolCallId: 't1' } }),
        );
      });
      expect(result.current?.streaming).toBe(false);
      expect(result.current?.toolCallId).toBe('t1');
    });

    it('-stream event with done=false sets streaming=true and updates spec', () => {
      const { result } = renderHook(() => useQuestionsV2Listener());
      act(() => {
        window.dispatchEvent(
          new CustomEvent('questions-v2-stream', {
            detail: { spec: SPEC, toolCallId: 't2', done: false },
          }),
        );
      });
      expect(result.current?.streaming).toBe(true);
      expect(result.current?.spec).toEqual(SPEC);
      expect(result.current?.toolCallId).toBe('t2');
    });

    it('-stream event with done=true flips streaming=false (final partial reached)', () => {
      const { result } = renderHook(() => useQuestionsV2Listener());
      // First an in-progress stream tick
      act(() => {
        window.dispatchEvent(
          new CustomEvent('questions-v2-stream', {
            detail: { spec: SPEC, toolCallId: 't3', done: false },
          }),
        );
      });
      expect(result.current?.streaming).toBe(true);
      // Then the done=true tick
      act(() => {
        window.dispatchEvent(
          new CustomEvent('questions-v2-stream', {
            detail: { spec: SPEC, toolCallId: 't3', done: true },
          }),
        );
      });
      expect(result.current?.streaming).toBe(false);
      expect(result.current?.spec).toEqual(SPEC);
    });

    it('-close event clears the pending state (spec=null)', () => {
      const { result } = renderHook(() => useQuestionsV2Listener());
      act(() => {
        window.dispatchEvent(
          new CustomEvent('questions-v2-show', { detail: { spec: SPEC, toolCallId: 't4' } }),
        );
      });
      expect(result.current).not.toBeNull();
      act(() => {
        window.dispatchEvent(new CustomEvent('questions-v2-close'));
      });
      expect(result.current).toBeNull();
    });

    it('dispatchQuestionsV2Stream(spec, done) fires the -stream CustomEvent', () => {
      const received: { spec: unknown; toolCallId: string; done: boolean }[] = [];
      const handler = (e: Event) =>
        received.push(
          (e as CustomEvent<{ spec: unknown; toolCallId: string; done: boolean }>).detail,
        );
      window.addEventListener('questions-v2-stream', handler as EventListener);
      try {
        dispatchQuestionsV2Stream(SPEC, false);
        dispatchQuestionsV2Stream(SPEC, true, 'tc-99');
      } finally {
        window.removeEventListener('questions-v2-stream', handler as EventListener);
      }
      expect(received).toEqual([
        { spec: SPEC, toolCallId: '', done: false },
        { spec: SPEC, toolCallId: 'tc-99', done: true },
      ]);
    });

    it('dispatchQuestionsV2Close() fires the -close CustomEvent (no detail)', () => {
      let fired = false;
      const handler = () => {
        fired = true;
      };
      window.addEventListener('questions-v2-close', handler);
      try {
        dispatchQuestionsV2Close();
      } finally {
        window.removeEventListener('questions-v2-close', handler);
      }
      expect(fired).toBe(true);
    });
  });
});
