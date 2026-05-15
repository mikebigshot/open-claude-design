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

  it('strips <skill-attachment> wrapper from user-visible text but keeps chip', () => {
    // After W3 / F2, sendMessage stores text as `inlineAttachmentsIntoText`
    // output — the literal XML for the LLM, followed by the human prose. The
    // human reading the chat should see only the prose; the chip already
    // surfaces the attachment.
    mount({
      id: 'u6',
      role: 'user',
      parts: [
        {
          type: 'text',
          text:
            '<skill-attachment name="Make a deck">\nFull skill prompt body that is long and irrelevant to the reader.\n</skill-attachment>\n\nplease make a deck',
        },
      ],
      attachments: [{ id: 'a1', name: 'Make a deck', type: 'skill', content: 'irrelevant' }],
    });
    const bubble = screen.getByText(/please make a deck/);
    expect(bubble.textContent ?? '').not.toContain('<skill-attachment');
    expect(bubble.textContent ?? '').not.toContain('</skill-attachment>');
    expect(bubble.textContent ?? '').not.toMatch(/full skill prompt body/i);
    // Chip still present
    expect(screen.getByTestId('attachment-chip-a1')).toBeInTheDocument();
  });

  it('strips multiple wrapper kinds and keeps the trailing prose visible', () => {
    mount({
      id: 'u7',
      role: 'user',
      parts: [
        {
          type: 'text',
          text:
            '<skill-attachment name="Make a deck">\nA\n</skill-attachment>\n\n<design-system-guide name="Linear DS">\nB\n</design-system-guide>\n\nmix these in',
        },
      ],
      attachments: [
        { id: 'a1', name: 'Make a deck', type: 'skill', content: 'A' },
        { id: 'a2', name: 'Linear DS', type: 'designSystem', content: 'B' },
      ],
    });
    const bubble = screen.getByText(/mix these in/);
    expect(bubble.textContent ?? '').not.toContain('<skill-attachment');
    expect(bubble.textContent ?? '').not.toContain('<design-system-guide');
    expect(screen.getByTestId('attachment-chip-a1')).toBeInTheDocument();
    expect(screen.getByTestId('attachment-chip-a2')).toBeInTheDocument();
  });

  it('renders chips from XML even when message.attachments is missing (persisted-without-D1 fallback)', () => {
    // P2 covers the D1 attachments column. Until that lands, reloaded messages
    // arrive with the XML still in the text and no attachments[]. Strip should
    // still surface chips for those.
    mount({
      id: 'u8',
      role: 'user',
      parts: [
        {
          type: 'text',
          text:
            '<skill-attachment name="Make a deck">\nbody\n</skill-attachment>\n\nplease make a deck',
        },
      ],
    });
    const bubble = screen.getByText(/please make a deck/);
    expect(bubble.textContent ?? '').not.toContain('<skill-attachment');
    // Synthetic chip rendered from stripped block; testid keyed by index.
    expect(screen.getByTestId('attachment-chip-stripped-0')).toBeInTheDocument();
    expect(screen.getByTestId('attachment-chip-stripped-0').textContent).toContain('Make a deck');
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
