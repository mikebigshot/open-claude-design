// ChatMsg — single message renderer.
//
// Pure render over `message.parts`. We don't need real AI SDK types — the
// component switches on `part.type` strings, so hand-built literals are
// enough. We cast through `as DesignAgentUIMessage` to satisfy the prop type
// without dragging in the agent's full type machinery.

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { ChatMsg } from '../ChatMsg';
import type { DesignAgentUIMessage } from '../ui-messages';
import { theme } from '@/theme/theme';

afterEach(() => cleanup());

function renderMsg(msg: unknown): void {
  render(
    <ThemeProvider theme={theme}>
      <ChatMsg message={msg as DesignAgentUIMessage} />
    </ThemeProvider>,
  );
}

describe('ChatMsg', () => {
  it('renders a user message as a single bubble joining all text parts', () => {
    renderMsg({
      id: 'm1',
      role: 'user',
      parts: [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
    });
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders a placeholder space for an empty user message (preserves the bubble shape)', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <ChatMsg
          message={{ id: 'm1', role: 'user', parts: [] } as unknown as DesignAgentUIMessage}
        />
      </ThemeProvider>,
    );
    // The bubble div renders with a single whitespace inside (regular or NBSP).
    expect(container.firstChild?.textContent).toMatch(/^\s$/);
  });

  it('renders an assistant text part inside an Atelier block with the brand header', () => {
    renderMsg({
      id: 'm2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Sure thing.' }],
    });
    expect(screen.getByText('Atelier')).toBeInTheDocument();
    expect(screen.getByText('Sure thing.')).toBeInTheDocument();
  });

  it('skips empty assistant text parts (no Atelier block)', () => {
    renderMsg({
      id: 'm3',
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
    });
    expect(screen.queryByText('Atelier')).toBeNull();
  });

  it('renders tool parts with the right verb labels and target paths', () => {
    renderMsg({
      id: 'm4',
      role: 'assistant',
      parts: [
        {
          type: 'tool-edit_file',
          state: 'output-available',
          input: { path: 'src/App.jsx' },
          toolCallId: 'c1',
        },
        {
          type: 'tool-read_file',
          state: 'input-available',
          input: { path: 'src/Other.jsx' },
          toolCallId: 'c2',
        },
        {
          type: 'tool-list_files',
          state: 'output-available',
          input: {},
          toolCallId: 'c3',
        },
        {
          type: 'tool-mark_done',
          state: 'output-available',
          input: { message: 'all done' },
          toolCallId: 'c4',
        },
      ],
    });

    expect(screen.getByText('WRITING')).toBeInTheDocument();
    expect(screen.getByText('src/App.jsx')).toBeInTheDocument();
    expect(screen.getByText('READING')).toBeInTheDocument();
    expect(screen.getByText('src/Other.jsx')).toBeInTheDocument();
    expect(screen.getByText('LISTING')).toBeInTheDocument();
    expect(screen.getByText('files')).toBeInTheDocument();
    expect(screen.getByText('DONE')).toBeInTheDocument();
    expect(screen.getByText('all done')).toBeInTheDocument();
  });

  it('shows the per-state badge label (✓ / ⟳ / … / ✗)', () => {
    renderMsg({
      id: 'm5',
      role: 'assistant',
      parts: [
        {
          type: 'tool-edit_file',
          state: 'output-available',
          input: { path: 'a' },
          toolCallId: 'c1',
        },
        {
          type: 'tool-edit_file',
          state: 'input-streaming',
          input: { path: 'b' },
          toolCallId: 'c2',
        },
        {
          type: 'tool-edit_file',
          state: 'input-available',
          input: { path: 'c' },
          toolCallId: 'c3',
        },
        {
          type: 'tool-edit_file',
          state: 'output-error',
          input: { path: 'd' },
          toolCallId: 'c4',
        },
      ],
    });

    expect(screen.getByText('✓')).toBeInTheDocument();
    expect(screen.getByText('…')).toBeInTheDocument();
    expect(screen.getByText('⟳')).toBeInTheDocument();
    expect(screen.getByText('✗')).toBeInTheDocument();
  });

  it('falls back to type-derived verb for unknown tool types', () => {
    renderMsg({
      id: 'm6',
      role: 'assistant',
      parts: [
        {
          type: 'tool-custom_thing',
          state: 'output-available',
          input: { path: '/foo' },
          toolCallId: 'c1',
        },
      ],
    });
    // 'custom_thing'.toUpperCase().slice(0, 8) === 'CUSTOM_T'
    expect(screen.getByText('CUSTOM_T')).toBeInTheDocument();
    expect(screen.getByText('/foo')).toBeInTheDocument();
  });

  it('groups consecutive tool parts into a single framed block', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <ChatMsg
          message={
            {
              id: 'm7',
              role: 'assistant',
              parts: [
                { type: 'text', text: 'thinking…' },
                {
                  type: 'tool-edit_file',
                  state: 'output-available',
                  input: { path: 'a' },
                  toolCallId: 'c1',
                },
                {
                  type: 'tool-read_file',
                  state: 'output-available',
                  input: { path: 'b' },
                  toolCallId: 'c2',
                },
                { type: 'text', text: 'done.' },
              ],
            } as unknown as DesignAgentUIMessage
          }
        />
      </ThemeProvider>,
    );

    // Both tool rows should share a parent. Find the WRITING row, walk up,
    // and confirm it also contains READING.
    const writing = screen.getByText('WRITING');
    const monoBlock = writing.closest('div')?.parentElement;
    expect(monoBlock).toBeTruthy();
    expect(monoBlock!.textContent).toContain('WRITING');
    expect(monoBlock!.textContent).toContain('READING');
    // The textContent should NOT include 'thinking…' or 'done.' from the
    // surrounding text blocks (those live in separate AtelierBlocks).
    expect(monoBlock!.textContent).not.toContain('thinking');
    expect(monoBlock!.textContent).not.toContain('done.');

    // Sanity: container has Atelier blocks for both surrounding text parts.
    expect(container.textContent).toContain('thinking…');
    expect(container.textContent).toContain('done.');
  });
});
