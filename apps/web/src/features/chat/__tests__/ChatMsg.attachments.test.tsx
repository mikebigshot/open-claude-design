// ChatMsg attachment-chip rendering — covers the v2 user-message
// `attachments[]` field that we surface as small pill-shaped chips beneath
// the bubble. Pure UI; the message-payload inlining is W1's job (helper
// shipped in attachment-inline.ts).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';
import { ChatMsg } from '../ChatMsg';
import type { DesignAgentUIMessage } from '../ui-messages';

afterEach(() => cleanup());

function mount(message: unknown) {
  return render(
    <ThemeProvider theme={theme}>
      <ChatMsg message={message as DesignAgentUIMessage} />
    </ThemeProvider>,
  );
}

describe('ChatMsg attachment chips', () => {
  it('renders a skill chip below the user bubble when attachments include a skill', () => {
    mount({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'please make a deck' }],
      attachments: [{ id: 'a1', name: 'Make a deck', type: 'skill', content: '…' }],
    });
    expect(screen.getByText(/please make a deck/)).toBeInTheDocument();
    const chip = screen.getByTestId('attachment-chip-a1');
    expect(chip.textContent).toMatch(/skill/i);
    expect(chip.textContent).toContain('Make a deck');
  });

  it('renders a design-system chip with the design-system label', () => {
    mount({
      id: 'u2',
      role: 'user',
      parts: [{ type: 'text', text: 'use these tokens' }],
      attachments: [{ id: 'a2', name: 'Linear DS', type: 'designSystem', content: '…' }],
    });
    const chip = screen.getByTestId('attachment-chip-a2');
    expect(chip.textContent).toMatch(/design system/i);
    expect(chip.textContent).toContain('Linear DS');
  });

  it('renders one chip per attachment, in order', () => {
    mount({
      id: 'u3',
      role: 'user',
      parts: [{ type: 'text', text: 'two attachments' }],
      attachments: [
        { id: 'a1', name: 'Make a deck', type: 'skill', content: '' },
        { id: 'a2', name: 'spec.md', type: 'file', content: '' },
      ],
    });
    expect(screen.getByTestId('attachment-chip-a1')).toBeInTheDocument();
    expect(screen.getByTestId('attachment-chip-a2')).toBeInTheDocument();
  });

  it('renders no chip row when attachments is undefined', () => {
    mount({
      id: 'u4',
      role: 'user',
      parts: [{ type: 'text', text: 'no attachments' }],
    });
    expect(screen.queryByTestId(/^attachment-chip-/)).toBeNull();
  });

  it('renders no chip row when attachments is an empty array', () => {
    mount({
      id: 'u5',
      role: 'user',
      parts: [{ type: 'text', text: 'empty attachments' }],
      attachments: [],
    });
    expect(screen.queryByTestId(/^attachment-chip-/)).toBeNull();
  });

  it('does not render attachment chips on assistant messages', () => {
    // attachments is typed as optional on the union but only meaningful on
    // user-role messages; if a stray assistant message carries one, we
    // still don't render it (assistant messages render parts only).
    mount({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }],
      attachments: [{ id: 'x', name: 'should not show', type: 'skill', content: '' }],
    });
    expect(screen.queryByTestId(/^attachment-chip-/)).toBeNull();
  });
});
