// DrawDock — note textarea + button wiring.
//
// 2026-05-03: Per img_6 design, the dock now includes a free-form note
// textarea between the sub-mode toggles and the action buttons. The note
// becomes the chat-submit text on Send (PreviewPanel.sendDraw reads it).
// We test the textarea renders, accepts input, surfaces aria-label, and
// that onNoteChange wires through.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';
import { DrawDock, type DrawDockProps } from '../DrawDock';

afterEach(() => {
  cleanup();
});

function makeProps(overrides: Partial<DrawDockProps> = {}): DrawDockProps {
  return {
    subMode: 'draw',
    strokeCount: 1, // > 0 so Send is enabled
    note: '',
    onNoteChange: vi.fn(),
    onSubModeChange: vi.fn(),
    onUndo: vi.fn(),
    onDiscard: vi.fn(),
    onSend: vi.fn(),
    ...overrides,
  };
}

function mount(props: DrawDockProps) {
  return render(
    <ThemeProvider theme={theme}>
      <DrawDock {...props} />
    </ThemeProvider>,
  );
}

describe('DrawDock note input', () => {
  it('renders a textarea with the design placeholder copy', () => {
    mount(makeProps());
    const textarea = screen.getByPlaceholderText('Type anywhere to add a note');
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('exposes aria-label "Note for annotated screenshot" for screen readers', () => {
    mount(makeProps());
    const textarea = screen.getByLabelText('Note for annotated screenshot');
    expect(textarea).toBeInTheDocument();
  });

  it('reflects the controlled note value', () => {
    mount(makeProps({ note: 'fix the header alignment' }));
    const textarea = screen.getByPlaceholderText(
      'Type anywhere to add a note',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('fix the header alignment');
  });

  it('calls onNoteChange when the user types', () => {
    const onNoteChange = vi.fn();
    mount(makeProps({ onNoteChange }));
    const textarea = screen.getByPlaceholderText('Type anywhere to add a note');
    fireEvent.change(textarea, { target: { value: 'change copy' } });
    expect(onNoteChange).toHaveBeenCalledWith('change copy');
  });

  it('Send button stays enabled when there is at least one stroke (note is optional)', () => {
    mount(makeProps({ strokeCount: 1, note: '' }));
    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    expect(sendBtn).not.toBeDisabled();
  });

  it('Send button is disabled when stroke count is 0 even with a note', () => {
    mount(makeProps({ strokeCount: 0, note: 'something' }));
    const sendBtn = screen.getByRole('button', { name: /^Send/ });
    expect(sendBtn).toBeDisabled();
  });
});
