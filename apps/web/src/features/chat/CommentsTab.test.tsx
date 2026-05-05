// CommentsTab — render paths.
//
// We particularly care about the P1-7 degraded-mode rendering: when the
// initial comments fetch fails we must not lie to the user with the cheerful
// "no comments yet" copy. The error path tests pin that behavior.
//
// 2026-05-03 — Task 3 multi-select tests added: the checkbox UI per pin and
// the bottom action bar that aggregates selected pins into a single chat
// submission with optional note.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { en } from '@/i18n/locales/en';
import { theme } from '@/theme/theme';
import { CommentsTab, aggregateSelectedPins } from './CommentsTab';
import type { Pin } from './types';

// Stand-alone English translator for the unit tests — mirrors the fallback in
// `useI18n` (i18n/index.tsx) so we can call `aggregateSelectedPins` without
// mounting an `<I18nProvider>`.
const t = ((key: keyof typeof en, vars?: Record<string, string | number>) => {
  const raw = en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, n: string) => {
    const v = vars[n];
    return v == null ? `{${n}}` : String(v);
  });
}) as Parameters<typeof aggregateSelectedPins>[3];

afterEach(() => {
  cleanup();
});

function mount(props: Parameters<typeof CommentsTab>[0]) {
  return render(
    <ThemeProvider theme={theme}>
      <CommentsTab {...props} />
    </ThemeProvider>,
  );
}

const PIN: Pin = {
  id: 'p1',
  n: 1,
  text: 'looks great',
  createdAt: '2026-05-01T00:00:00.000Z',
  filePath: null,
};

describe('CommentsTab', () => {
  it('renders the cheerful empty state when there are no pins and no error', () => {
    mount({ pins: [] });
    expect(screen.getByText(/No comments yet/i)).toBeInTheDocument();
    // The error notice should NOT appear in the happy path.
    expect(screen.queryByTestId('comments-load-error')).toBeNull();
  });

  it('renders the error notice + degraded empty copy when load failed and no pins', () => {
    mount({ pins: [], loadError: 'HTTP 500 internal' });
    const banner = screen.getByTestId('comments-load-error');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner.textContent).toContain('HTTP 500 internal');
    // Importantly: do NOT show the cheerful "No comments yet" copy.
    expect(screen.queryByText(/No comments yet\./i)).toBeNull();
    // The degraded copy hints that pins may be missing.
    expect(screen.getByText(/earlier pins/i)).toBeInTheDocument();
  });

  it('still renders pins + a degraded notice when load failed but local pins exist', () => {
    // This case happens when the initial GET failed but the user has added
    // a pin in-session via the optimistic addPin flow.
    mount({ pins: [PIN], loadError: 'Service unavailable' });
    expect(screen.getByTestId('comments-load-error')).toBeInTheDocument();
    expect(screen.getByText(/looks great/)).toBeInTheDocument();
  });

  it('renders pins normally when no loadError is set', () => {
    mount({ pins: [PIN] });
    expect(screen.queryByTestId('comments-load-error')).toBeNull();
    expect(screen.getByText(/looks great/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Multi-select (Task 3 — 2026-05-03 — img_3 design)
// ─────────────────────────────────────────────────────────────────────────

const PIN_A: Pin = {
  id: 'a',
  n: 1,
  text: 'fix header',
  selector: '.hero',
  createdAt: '2026-05-01T00:00:00.000Z',
};
const PIN_B: Pin = {
  id: 'b',
  n: 2,
  text: 'add CTA',
  selector: '.cta',
  createdAt: '2026-05-01T00:00:00.000Z',
};

describe('CommentsTab multi-select', () => {
  it('does not render the checkbox UI when selectedIds is undefined (e.g. read-only)', () => {
    mount({ pins: [PIN_A, PIN_B] });
    expect(screen.queryByTestId('comment-checkbox-a')).toBeNull();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('renders a checkbox per pin with aria-label "Select comment N"', () => {
    mount({
      pins: [PIN_A, PIN_B],
      selectedIds: [],
      onToggleSelection: vi.fn(),
    });
    expect(screen.getByLabelText('Select comment 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Select comment 2')).toBeInTheDocument();
  });

  it('checkbox click calls onToggleSelection with the pin id (not propagating to row click)', () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    mount({
      pins: [PIN_A],
      selectedIds: [],
      onToggleSelection: onToggle,
      onSelect,
    });
    const checkbox = screen.getByTestId('comment-checkbox-a');
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith('a');
    // Row click handler must not fire when only the checkbox was clicked.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('reflects checked state from selectedIds', () => {
    mount({
      pins: [PIN_A, PIN_B],
      selectedIds: ['a'],
      onToggleSelection: vi.fn(),
    });
    expect(screen.getByTestId('comment-checkbox-a')).toBeChecked();
    expect(screen.getByTestId('comment-checkbox-b')).not.toBeChecked();
  });

  it('selection bar appears only when at least one pin is selected', () => {
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <CommentsTab
          pins={[PIN_A, PIN_B]}
          selectedIds={[]}
          onToggleSelection={vi.fn()}
          onSendSelected={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    rerender(
      <ThemeProvider theme={theme}>
        <CommentsTab
          pins={[PIN_A, PIN_B]}
          selectedIds={['a']}
          onToggleSelection={vi.fn()}
          onSendSelected={vi.fn()}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.getByTestId('selection-count').textContent).toContain('1 selected');
  });

  it('Add note toggles a textarea with aria-label "Note for selected comments"', () => {
    mount({
      pins: [PIN_A],
      selectedIds: ['a'],
      onToggleSelection: vi.fn(),
      onSendSelected: vi.fn(),
    });
    const addNoteBtn = screen.getByTestId('selection-add-note');
    expect(screen.queryByTestId('selection-note')).toBeNull();
    fireEvent.click(addNoteBtn);
    const textarea = screen.getByTestId('selection-note');
    expect(textarea).toHaveAttribute('aria-label', 'Note for selected comments');
  });

  it('Send to Claude calls onSendSelected with the typed note', () => {
    const onSend = vi.fn();
    mount({
      pins: [PIN_A, PIN_B],
      selectedIds: ['a', 'b'],
      onToggleSelection: vi.fn(),
      onSendSelected: onSend,
    });
    fireEvent.click(screen.getByTestId('selection-add-note'));
    fireEvent.change(screen.getByTestId('selection-note'), {
      target: { value: 'please address all of these' },
    });
    fireEvent.click(screen.getByTestId('selection-send'));
    expect(onSend).toHaveBeenCalledWith('please address all of these');
  });

  it('Send to Claude with no note still calls onSendSelected (note is optional)', () => {
    const onSend = vi.fn();
    mount({
      pins: [PIN_A],
      selectedIds: ['a'],
      onToggleSelection: vi.fn(),
      onSendSelected: onSend,
    });
    fireEvent.click(screen.getByTestId('selection-send'));
    expect(onSend).toHaveBeenCalledWith('');
  });
});

describe('aggregateSelectedPins', () => {
  it('joins pin lines with selector + text in pin-id order', () => {
    const text = aggregateSelectedPins([PIN_A, PIN_B], ['a', 'b'], '', t);
    const lines = text.split('\n');
    expect(lines[0]).toBe('📍 [Pin 1] `.hero` — fix header');
    expect(lines[1]).toBe('📍 [Pin 2] `.cta` — add CTA');
  });

  it('respects the selection order (not pin order)', () => {
    const text = aggregateSelectedPins([PIN_A, PIN_B], ['b', 'a'], '', t);
    expect(text.split('\n')[0]).toContain('Pin 2');
    expect(text.split('\n')[1]).toContain('Pin 1');
  });

  it('skips ids that do not resolve to a pin (defensive)', () => {
    const text = aggregateSelectedPins([PIN_A], ['a', 'ghost'], '', t);
    expect(text.split('\n')).toHaveLength(1);
  });

  it('renders "(no selector)" when pin has no selector', () => {
    const noSel: Pin = {
      id: 'x',
      n: 5,
      text: 'comment',
      createdAt: '2026-05-01T00:00:00.000Z',
    };
    const text = aggregateSelectedPins([noSel], ['x'], '', t);
    expect(text).toContain('(no selector)');
  });

  it('renders "(no comment)" when pin text is empty/whitespace', () => {
    const empty: Pin = {
      id: 'x',
      n: 5,
      text: '   ',
      selector: '.foo',
      createdAt: '2026-05-01T00:00:00.000Z',
    };
    const text = aggregateSelectedPins([empty], ['x'], '', t);
    expect(text).toContain('(no comment)');
  });

  it('appends the optional note after a blank line', () => {
    const text = aggregateSelectedPins([PIN_A], ['a'], 'please update copy', t);
    expect(text).toContain('please update copy');
    // blank-line separator between the pin lines and the note.
    expect(text).toMatch(/fix header\n\nplease update copy$/);
  });

  it('omits the note section entirely when note is whitespace only', () => {
    const text = aggregateSelectedPins([PIN_A], ['a'], '   ', t);
    expect(text).toBe('📍 [Pin 1] `.hero` — fix header');
  });
});
