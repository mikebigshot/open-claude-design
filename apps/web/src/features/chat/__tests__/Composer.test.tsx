// Composer — controlled chat input with chips, model dropdown, send/stop.
//
// Pure presentation: caller owns text/chips/model state. Verifies the four
// interaction surfaces (typing, send keystroke, chip remove, stop button).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { Composer } from '../Composer';
import { theme } from '@/theme/theme';
import { I18nProvider } from '@/i18n';
import type { ChipPrim } from '../types';
import type { Attachment } from '../ui-messages';

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>> = {}): {
  onSubmit: ReturnType<typeof vi.fn>;
  onChange: ReturnType<typeof vi.fn>;
  onStop: ReturnType<typeof vi.fn>;
  onChipsChange: ReturnType<typeof vi.fn>;
  onModelChange: ReturnType<typeof vi.fn>;
} {
  const onSubmit = vi.fn();
  const onChange = vi.fn();
  const onStop = vi.fn();
  const onChipsChange = vi.fn();
  const onModelChange = vi.fn();
  render(
    <I18nProvider initial="en">
      <ThemeProvider theme={theme}>
        <Composer
          projectId="p1"
          value=""
          onChange={onChange}
          onSubmit={onSubmit}
          onStop={onStop}
          onChipsChange={onChipsChange}
          onModelChange={onModelChange}
          {...props}
        />
      </ThemeProvider>
    </I18nProvider>,
  );
  return { onSubmit, onChange, onStop, onChipsChange, onModelChange };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('Composer', () => {
  it('renders the textarea with the controlled value', () => {
    renderComposer({ value: 'hello' });
    const textarea = screen.getByLabelText('Chat composer') as HTMLTextAreaElement;
    expect(textarea.value).toBe('hello');
  });

  it('typing emits onChange with the new value', () => {
    const { onChange } = renderComposer({ value: '' });
    const textarea = screen.getByLabelText('Chat composer');
    act(() => fireEvent.change(textarea, { target: { value: 'hi' } }));
    expect(onChange).toHaveBeenCalledWith('hi');
  });

  it('Send button is disabled when value is empty/whitespace', () => {
    renderComposer({ value: '   ' });
    const sendBtn = screen.getByLabelText('Send');
    expect(sendBtn).toBeDisabled();
  });

  it('Send button is enabled when value has non-whitespace content', () => {
    renderComposer({ value: 'hi' });
    expect(screen.getByLabelText('Send')).not.toBeDisabled();
  });

  it('clicking Send calls onSubmit', () => {
    const { onSubmit } = renderComposer({ value: 'hi' });
    act(() => fireEvent.click(screen.getByLabelText('Send')));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('cmd+Enter calls onSubmit when value is non-empty', () => {
    const { onSubmit } = renderComposer({ value: 'hi' });
    const textarea = screen.getByLabelText('Chat composer');
    act(() => fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('ctrl+Enter calls onSubmit when value is non-empty', () => {
    const { onSubmit } = renderComposer({ value: 'hi' });
    const textarea = screen.getByLabelText('Chat composer');
    act(() => fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it('plain Enter does NOT call onSubmit (allows newline)', () => {
    const { onSubmit } = renderComposer({ value: 'hi' });
    const textarea = screen.getByLabelText('Chat composer');
    act(() => fireEvent.keyDown(textarea, { key: 'Enter' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cmd+Enter does NOT call onSubmit when send is disabled', () => {
    const { onSubmit } = renderComposer({ value: '   ' });
    const textarea = screen.getByLabelText('Chat composer');
    act(() => fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders the Stop button (and hides Send) when streaming with onStop', () => {
    renderComposer({ value: 'busy', streaming: true });
    expect(screen.queryByLabelText('Send')).toBeNull();
    expect(screen.getByLabelText('Stop')).toBeInTheDocument();
  });

  it('clicking Stop calls onStop', () => {
    const { onStop } = renderComposer({ value: 'busy', streaming: true });
    act(() => fireEvent.click(screen.getByLabelText('Stop')));
    expect(onStop).toHaveBeenCalled();
  });

  it('renders one chip per ChipPrim with a remove button', () => {
    const chips: ChipPrim[] = [
      { id: 'a', label: 'Foo', ref: 'r/a' },
      { id: 'b', label: 'Bar', ref: 'r/b' },
    ];
    renderComposer({ chips });
    expect(screen.getByText('Foo')).toBeInTheDocument();
    expect(screen.getByText('Bar')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove Foo')).toBeInTheDocument();
  });

  it('clicking a chip × calls onChipsChange with the chip removed', () => {
    const chips: ChipPrim[] = [
      { id: 'a', label: 'Foo', ref: 'r/a' },
      { id: 'b', label: 'Bar', ref: 'r/b' },
    ];
    const { onChipsChange } = renderComposer({ chips });
    act(() => fireEvent.click(screen.getByLabelText('Remove Foo')));
    expect(onChipsChange).toHaveBeenCalledWith([{ id: 'b', label: 'Bar', ref: 'r/b' }]);
  });

  it('clicking "Add context" toggles the ImportPopover', () => {
    renderComposer();
    const addBtn = screen.getByRole('button', { name: /Add context/i });
    expect(addBtn.getAttribute('aria-expanded')).toBe('false');
    act(() => fireEvent.click(addBtn));
    expect(addBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders the ModelDropdown only when onModelChange is provided', () => {
    // With onModelChange (default in helper).
    renderComposer({ value: 'x' });
    // ModelDropdown's trigger is a button containing the model label.
    expect(
      screen.getAllByRole('button').some((b) => b.textContent?.match(/(Sonnet|Opus|Haiku)/)),
    ).toBe(true);
    cleanup();

    // Without onModelChange.
    render(
      <ThemeProvider theme={theme}>
        <Composer projectId="p1" value="x" onChange={() => {}} onSubmit={() => {}} />
      </ThemeProvider>,
    );
    expect(
      screen.queryAllByRole('button').filter((b) => b.textContent?.match(/(Sonnet|Opus|Haiku)/)),
    ).toHaveLength(0);
  });
});

// ───── Skill attach flow ─────
//
// Spec §4.3 step 1-6: user clicks "Add context" → menu shows "Attach skill"
// (active, not SOON) → submenu lists 4 built-in skills → picking one attaches
// a chip [skill: <name> ×] above the textarea. Multiple skills can stack.
// On Send, attachments[] is forwarded to onSubmit and the chips clear.

describe('Composer skill attach', () => {
  it('Add context menu shows an active "Attach skill" item (no SOON badge)', () => {
    renderComposer();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    // The menu is rendered as role=menu by ImportPopover.
    const menu = screen.getByRole('menu');
    const skillItem = within(menu).getByRole('menuitem', { name: /Attach skill/i });
    expect(skillItem).toBeInTheDocument();
    expect(skillItem).not.toBeDisabled();
    // No SOON badge inside this row.
    expect(within(skillItem).queryByText(/SOON/i)).toBeNull();
  });

  it('clicking "Attach skill" lists the four built-in skill names', () => {
    renderComposer();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Attach skill/i })));
    // The submenu lists the 4 built-in skills by their frontmatter `name`.
    const picker = screen.getByRole('menu', { name: /skill picker/i });
    expect(within(picker).getByRole('menuitem', { name: /Frontend design/i })).toBeInTheDocument();
    expect(
      within(picker).getByRole('menuitem', { name: /Interactive prototype/i }),
    ).toBeInTheDocument();
    expect(within(picker).getByRole('menuitem', { name: /Make a deck/i })).toBeInTheDocument();
    expect(within(picker).getByRole('menuitem', { name: /Wireframe/i })).toBeInTheDocument();
  });

  it('picking a skill renders a chip "skill: <name>" with a remove button', () => {
    renderComposer();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Attach skill/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Make a deck/i })));
    // Skill chip should be present.
    const chip = screen.getByTestId('skill-chip-Make a deck');
    expect(chip).toHaveTextContent(/skill/i);
    expect(chip).toHaveTextContent(/Make a deck/);
    // Submenu auto-closes after pick.
    expect(screen.queryByRole('menu', { name: /skill picker/i })).toBeNull();
    // Remove button is accessible.
    expect(within(chip).getByLabelText(/Remove Make a deck/i)).toBeInTheDocument();
  });

  it('clicking the chip × removes the skill attachment', () => {
    renderComposer();
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Attach skill/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Wireframe/i })));
    expect(screen.getByTestId('skill-chip-Wireframe')).toBeInTheDocument();
    act(() => fireEvent.click(screen.getByLabelText(/Remove Wireframe/i)));
    expect(screen.queryByTestId('skill-chip-Wireframe')).toBeNull();
  });

  it('multiple skills can be attached and stack as chips', () => {
    renderComposer();
    // Attach 1: Make a deck
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Attach skill/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Make a deck/i })));
    // Attach 2: Wireframe
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Attach skill/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Wireframe/i })));
    expect(screen.getByTestId('skill-chip-Make a deck')).toBeInTheDocument();
    expect(screen.getByTestId('skill-chip-Wireframe')).toBeInTheDocument();
  });

  it('Send forwards skill attachments to onSubmit with full content from the registry', () => {
    const { onSubmit } = renderComposer({ value: 'please make a deck' });
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Attach skill/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Make a deck/i })));
    act(() => fireEvent.click(screen.getByLabelText(/Send/i)));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [pendingAttachments, skillAttachments] = onSubmit.mock.calls[0] as [
      unknown[],
      Attachment[] | undefined,
    ];
    expect(pendingAttachments).toEqual([]);
    expect(skillAttachments).toBeDefined();
    expect(skillAttachments).toHaveLength(1);
    expect(skillAttachments![0]?.type).toBe('skill');
    expect(skillAttachments![0]?.name).toBe('Make a deck');
    // The chip's content body must be the actual SKILL.md body (post-frontmatter)
    // — pulled from the registry. Don't assert exact length, just non-empty.
    expect(typeof skillAttachments![0]?.content).toBe('string');
    expect((skillAttachments![0]?.content ?? '').length).toBeGreaterThan(10);
    expect(skillAttachments![0]?.id).toBeTruthy();
  });

  it('after Send, skill chips clear from the composer', () => {
    const { onSubmit } = renderComposer({ value: 'go' });
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Attach skill/i })));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Make a deck/i })));
    expect(screen.getByTestId('skill-chip-Make a deck')).toBeInTheDocument();
    act(() => fireEvent.click(screen.getByLabelText(/Send/i)));
    expect(onSubmit).toHaveBeenCalled();
    // chip cleared post-send
    expect(screen.queryByTestId('skill-chip-Make a deck')).toBeNull();
  });

  it('empty skill attachment list still allows sending (onSubmit fires with [] for both)', () => {
    const { onSubmit } = renderComposer({ value: 'hi' });
    act(() => fireEvent.click(screen.getByLabelText(/Send/i)));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [pendingAttachments, skillAttachments] = onSubmit.mock.calls[0] as [
      unknown[],
      Attachment[] | undefined,
    ];
    expect(pendingAttachments).toEqual([]);
    // Either undefined or empty array — both valid "no skills attached" shapes.
    expect(skillAttachments === undefined || skillAttachments.length === 0).toBe(true);
  });
});
