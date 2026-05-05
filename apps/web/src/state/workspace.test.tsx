import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceProvider, useWorkspace } from './workspace';
import { DESIGN_FILES_TAB } from './types';
import type { ClickAnnotation, CommentPin, DrawShape, DrawStroke } from './types';

const wrapper =
  (projectId = 'p1', readOnly = false) =>
  ({ children }: { children: ReactNode }) => (
    <WorkspaceProvider projectId={projectId} readOnly={readOnly}>
      {children}
    </WorkspaceProvider>
  );

function setup(projectId = 'p1', readOnly = false) {
  return renderHook(() => useWorkspace(), { wrapper: wrapper(projectId, readOnly) });
}

const PIN: CommentPin = {
  id: 'pin-1',
  x: 0,
  y: 0,
  n: 1,
  text: '',
  createdAt: '2026-05-01T00:00:00.000Z',
};

function makePin(overrides: Partial<CommentPin> & { id: string; n: number }): CommentPin {
  return { x: 0, y: 0, text: '', createdAt: '2026-05-01T00:00:00.000Z', ...overrides };
}
const STROKE: DrawStroke = { type: 'draw', points: [[0, 0]] };
const CLICK: ClickAnnotation = { type: 'click', x: 10, y: 20 };

describe('workspace reducer', () => {
  // ---------------------------------------------------------------------------
  // initial state
  // ---------------------------------------------------------------------------
  describe('initial state', () => {
    it('hydrates makeInitialState defaults', () => {
      const { result } = setup('p1');
      const s = result.current.state;
      expect(s.projectId).toBe('p1');
      expect(s.activeTab).toBe(DESIGN_FILES_TAB);
      expect(s.tool).toBeNull();
      expect(s.pins).toEqual([]);
      expect(s.readOnly).toBe(false);
      expect(s.filesChangedAt).toBe(0);
    });

    it('readOnly=true is honored', () => {
      const { result } = setup('p1', true);
      expect(result.current.state.readOnly).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // project / tabs
  // ---------------------------------------------------------------------------
  describe('project / tabs', () => {
    it('open_file adds tab + activates it', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'open_file', name: 'A.jsx' }));
      expect(result.current.state.openTabs).toEqual(['A.jsx']);
      expect(result.current.state.activeTab).toBe('A.jsx');
    });

    it('open_file deduplicates existing tabs but still re-activates', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'open_file', name: 'A.jsx' }));
      act(() => result.current.dispatch({ type: 'open_file', name: 'B.jsx' }));
      act(() => result.current.dispatch({ type: 'open_file', name: 'A.jsx' }));
      expect(result.current.state.openTabs).toEqual(['A.jsx', 'B.jsx']);
      expect(result.current.state.activeTab).toBe('A.jsx');
    });

    it('close_tab removes tab + falls back to neighbor when closing active', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'open_file', name: 'A.jsx' }));
      act(() => result.current.dispatch({ type: 'open_file', name: 'B.jsx' }));
      act(() => result.current.dispatch({ type: 'close_tab', name: 'B.jsx' }));
      expect(result.current.state.openTabs).toEqual(['A.jsx']);
      expect(result.current.state.activeTab).toBe('A.jsx');
    });

    it('close_tab on last tab falls back to DESIGN_FILES_TAB', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'open_file', name: 'A.jsx' }));
      act(() => result.current.dispatch({ type: 'close_tab', name: 'A.jsx' }));
      expect(result.current.state.activeTab).toBe(DESIGN_FILES_TAB);
    });

    it('close_tab on missing tab is a no-op', () => {
      const { result } = setup();
      const before = result.current.state;
      act(() => result.current.dispatch({ type: 'close_tab', name: 'missing.jsx' }));
      expect(result.current.state).toBe(before);
    });

    it('set_active_tab changes only activeTab', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_active_tab', tab: 'X' }));
      expect(result.current.state.activeTab).toBe('X');
    });
  });

  // ---------------------------------------------------------------------------
  // tools / pins (4 actions)
  // ---------------------------------------------------------------------------
  describe('tools / pins', () => {
    it('set_tool swaps tool', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_tool', tool: 'tweaks' }));
      expect(result.current.state.tool).toBe('tweaks');
    });

    it('add_pin appends to pins', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'add_pin', pin: PIN }));
      expect(result.current.state.pins).toEqual([PIN]);
    });

    it('set_drawing_pin updates drawingPin (set + clear)', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_drawing_pin', pin: PIN }));
      expect(result.current.state.drawingPin).toEqual(PIN);
      act(() => result.current.dispatch({ type: 'set_drawing_pin', pin: null }));
      expect(result.current.state.drawingPin).toBeNull();
    });

    it('remove_pin filters by id', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'add_pin', pin: makePin({ id: 'a', n: 1 }) }));
      act(() => result.current.dispatch({ type: 'add_pin', pin: makePin({ id: 'b', n: 2 }) }));
      act(() => result.current.dispatch({ type: 'remove_pin', id: 'a' }));
      expect(result.current.state.pins.map((p) => p.id)).toEqual(['b']);
    });

    it('set_pins replaces full pins list (used by hydrate)', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'add_pin', pin: makePin({ id: 'a', n: 1 }) }));
      act(() =>
        result.current.dispatch({
          type: 'set_pins',
          pins: [makePin({ id: 'x', n: 9 }), makePin({ id: 'y', n: 10 })],
        }),
      );
      expect(result.current.state.pins.map((p) => p.id)).toEqual(['x', 'y']);
    });
  });

  // ---------------------------------------------------------------------------
  // multi-select (Task 3 — 2026-05-03)
  // ---------------------------------------------------------------------------
  describe('multi-select pins', () => {
    it('selectedPinIds defaults to empty array', () => {
      const { result } = setup();
      expect(result.current.state.selectedPinIds).toEqual([]);
    });

    it('toggle_pin_selection adds an id when not present', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'a' }));
      expect(result.current.state.selectedPinIds).toEqual(['a']);
    });

    it('toggle_pin_selection removes an id when already present', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'a' }));
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'b' }));
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'a' }));
      expect(result.current.state.selectedPinIds).toEqual(['b']);
    });

    it('clear_pin_selection wipes the array', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'a' }));
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'b' }));
      act(() => result.current.dispatch({ type: 'clear_pin_selection' }));
      expect(result.current.state.selectedPinIds).toEqual([]);
    });

    it('set_pin_selection replaces the entire selection', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'old' }));
      act(() => result.current.dispatch({ type: 'set_pin_selection', ids: ['x', 'y'] }));
      expect(result.current.state.selectedPinIds).toEqual(['x', 'y']);
    });

    it('remove_pin drops the id from selection so callers do not send stale ids', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'add_pin', pin: makePin({ id: 'a', n: 1 }) }));
      act(() => result.current.dispatch({ type: 'add_pin', pin: makePin({ id: 'b', n: 2 }) }));
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'a' }));
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'b' }));
      act(() => result.current.dispatch({ type: 'remove_pin', id: 'a' }));
      expect(result.current.state.selectedPinIds).toEqual(['b']);
    });

    it('set_pins prunes selection ids that no longer exist after the new fetch', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'add_pin', pin: makePin({ id: 'a', n: 1 }) }));
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'a' }));
      act(() => result.current.dispatch({ type: 'toggle_pin_selection', id: 'b' }));
      // Hydrate fetches a fresh list that contains only "a" — "b" is stale.
      act(() => result.current.dispatch({ type: 'set_pins', pins: [makePin({ id: 'a', n: 1 })] }));
      expect(result.current.state.selectedPinIds).toEqual(['a']);
    });
  });

  // ---------------------------------------------------------------------------
  // modal / popover (2 actions; set_share_open removed in Task 1 scope expansion)
  // ---------------------------------------------------------------------------
  describe('modal / popover', () => {
    it.each([
      ['set_import_open', 'importOpen'],
      ['set_model_open', 'modelOpen'],
    ] as const)('%s toggles %s independently', (type, key) => {
      const { result } = setup();
      act(() => result.current.dispatch({ type, open: true } as never));
      expect(result.current.state[key]).toBe(true);
      act(() => result.current.dispatch({ type, open: false } as never));
      expect(result.current.state[key]).toBe(false);
    });
  });

  // (composer / chips / messages / model / streaming / chatTab / project_id /
  // read_only / reset have all moved out of workspace state — owned by
  // useChat / useState / lib/model-pref / WorkspaceProvider props instead.
  // See state/types.ts WorkspaceState comment.)

  // ---------------------------------------------------------------------------
  // edit state (1 action; Tweaks fallback removed — now artifact-driven only)
  // ---------------------------------------------------------------------------
  describe('edit state', () => {
    it('set_edit merges partial without dropping other keys', () => {
      const { result } = setup();
      const before = result.current.state.edit;
      act(() => result.current.dispatch({ type: 'set_edit', edit: { font: 'Comic Sans' } }));
      expect(result.current.state.edit.font).toBe('Comic Sans');
      expect(result.current.state.edit.bg).toBe(before.bg);
      expect(result.current.state.edit.base).toBe(before.base);
      expect(result.current.state.edit.headingSize).toBe(before.headingSize);
    });
  });

  // ---------------------------------------------------------------------------
  // pendingChatSubmit (PreviewPanel → ChatPanel queue)
  // ---------------------------------------------------------------------------
  describe('pendingChatSubmit queue', () => {
    it('queue_chat_submit stages a request, then clears with null', () => {
      const { result } = setup();
      expect(result.current.state.pendingChatSubmit).toBeNull();
      act(() =>
        result.current.dispatch({
          type: 'queue_chat_submit',
          request: {
            text: '🎨 sketch',
            attachments: [{ mediaType: 'image/png', url: 'data:...' }],
          },
        }),
      );
      expect(result.current.state.pendingChatSubmit?.text).toBe('🎨 sketch');
      expect(result.current.state.pendingChatSubmit?.attachments).toHaveLength(1);
      act(() => result.current.dispatch({ type: 'queue_chat_submit', request: null }));
      expect(result.current.state.pendingChatSubmit).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // composerSeed (Examples → "Use this prompt" pre-fill, 2026-05-04)
  // ---------------------------------------------------------------------------
  describe('composerSeed', () => {
    it('defaults to null', () => {
      const { result } = setup();
      expect(result.current.state.composerSeed).toBeNull();
    });

    it('set_composer_seed stages a seed string', () => {
      const { result } = setup();
      act(() =>
        result.current.dispatch({ type: 'set_composer_seed', seed: 'Build me a TODO app' }),
      );
      expect(result.current.state.composerSeed).toBe('Build me a TODO app');
    });

    it('set_composer_seed with null clears the seed', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_composer_seed', seed: 'hello' }));
      expect(result.current.state.composerSeed).toBe('hello');
      act(() => result.current.dispatch({ type: 'set_composer_seed', seed: null }));
      expect(result.current.state.composerSeed).toBeNull();
    });

    it('clear_composer_seed wipes the seed', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_composer_seed', seed: 'hello' }));
      act(() => result.current.dispatch({ type: 'clear_composer_seed' }));
      expect(result.current.state.composerSeed).toBeNull();
    });

    it('actions.setComposerSeed + clearComposerSeed wrappers dispatch correctly', () => {
      const { result } = setup();
      act(() => result.current.actions.setComposerSeed('From the action wrapper'));
      expect(result.current.state.composerSeed).toBe('From the action wrapper');
      act(() => result.current.actions.clearComposerSeed());
      expect(result.current.state.composerSeed).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // draw (7 actions)
  // ---------------------------------------------------------------------------
  describe('draw', () => {
    it('set_draw_sub_mode swaps sub mode', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_draw_sub_mode', mode: 'click' }));
      expect(result.current.state.drawSubMode).toBe('click');
    });

    it('begin_draw seeds drawing stroke', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'begin_draw', stroke: STROKE }));
      expect(result.current.state.drawing).toEqual(STROKE);
    });

    it('add_click_annotation appends to drawStrokes', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'add_click_annotation', click: CLICK }));
      expect(result.current.state.drawStrokes).toEqual([CLICK]);
    });

    it('extend_drawing appends point to active drawing (no-op when no drawing)', () => {
      const { result } = setup();
      const before = result.current.state;
      act(() => result.current.dispatch({ type: 'extend_drawing', point: [1, 1] }));
      expect(result.current.state).toBe(before);
      act(() => result.current.dispatch({ type: 'begin_draw', stroke: STROKE }));
      act(() => result.current.dispatch({ type: 'extend_drawing', point: [5, 5] }));
      expect(result.current.state.drawing?.points).toEqual([
        [0, 0],
        [5, 5],
      ]);
    });

    it('end_drawing flushes drawing into drawStrokes (no-op when no drawing)', () => {
      const { result } = setup();
      const before = result.current.state;
      act(() => result.current.dispatch({ type: 'end_drawing' }));
      expect(result.current.state).toBe(before);
      act(() => result.current.dispatch({ type: 'begin_draw', stroke: STROKE }));
      act(() => result.current.dispatch({ type: 'end_drawing' }));
      expect(result.current.state.drawing).toBeNull();
      expect(result.current.state.drawStrokes).toEqual([STROKE]);
    });

    it('set_draw_strokes replaces strokes', () => {
      const { result } = setup();
      const strokes: DrawShape[] = [STROKE];
      act(() => result.current.dispatch({ type: 'set_draw_strokes', strokes }));
      expect(result.current.state.drawStrokes).toEqual(strokes);
    });

    it('undo_stroke pops last stroke', () => {
      const { result } = setup();
      act(() =>
        result.current.dispatch({
          type: 'set_draw_strokes',
          strokes: [STROKE, STROKE, STROKE],
        }),
      );
      act(() => result.current.dispatch({ type: 'undo_stroke' }));
      expect(result.current.state.drawStrokes).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // files_changed (1 action, tick semantics)
  // ---------------------------------------------------------------------------
  describe('zoom', () => {
    it("defaults to 'fit'", () => {
      const { result } = setup();
      expect(result.current.state.zoom).toBe('fit');
    });

    it('set_zoom accepts a numeric value', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_zoom', zoom: 1.5 }));
      expect(result.current.state.zoom).toBe(1.5);
    });

    it("set_zoom accepts 'fit' to reset", () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_zoom', zoom: 0.5 }));
      expect(result.current.state.zoom).toBe(0.5);
      act(() => result.current.dispatch({ type: 'set_zoom', zoom: 'fit' }));
      expect(result.current.state.zoom).toBe('fit');
    });
  });

  describe('previewingFile', () => {
    it('defaults to null', () => {
      const { result } = setup();
      expect(result.current.state.previewingFile).toBeNull();
    });

    it('set_previewing_file stores the path', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_previewing_file', path: 'App.jsx' }));
      expect(result.current.state.previewingFile).toBe('App.jsx');
    });

    it('set_previewing_file with null clears it', () => {
      const { result } = setup();
      act(() => result.current.dispatch({ type: 'set_previewing_file', path: 'App.jsx' }));
      act(() => result.current.dispatch({ type: 'set_previewing_file', path: null }));
      expect(result.current.state.previewingFile).toBeNull();
    });
  });

  describe('files_changed tick', () => {
    it('strictly increments filesChangedAt on each dispatch', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
        const { result } = setup();
        expect(result.current.state.filesChangedAt).toBe(0);
        act(() => result.current.dispatch({ type: 'files_changed' }));
        const t1 = result.current.state.filesChangedAt;
        expect(t1).toBeGreaterThan(0);
        vi.advanceTimersByTime(1000);
        act(() => result.current.dispatch({ type: 'files_changed' }));
        expect(result.current.state.filesChangedAt).toBeGreaterThan(t1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // immutability (sample 3 surviving actions)
  // ---------------------------------------------------------------------------
  describe('immutability', () => {
    it.each(['set_active_tab' as const, 'set_tool' as const, 'files_changed' as const])(
      'does not mutate previous state ref on %s',
      (type) => {
        const { result } = setup();
        const before = result.current.state;
        const action = (() => {
          switch (type) {
            case 'set_active_tab':
              return { type, tab: 'X' };
            case 'set_tool':
              return { type, tool: 'tweaks' as const };
            case 'files_changed':
              return { type };
          }
        })();
        act(() => result.current.dispatch(action as never));
        expect(Object.is(before, result.current.state)).toBe(false);
      },
    );
  });
});
