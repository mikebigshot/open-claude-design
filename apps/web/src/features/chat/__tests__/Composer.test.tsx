// Composer — controlled chat input with chips, model dropdown, send/stop.
//
// Pure presentation: caller owns text/chips/model state. Verifies the four
// interaction surfaces (typing, send keystroke, chip remove, stop button).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { Composer } from '../Composer';
import { theme } from '@/theme/theme';
import type { ChipPrim } from '../types';

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
    </ThemeProvider>,
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
