// ChatMsg — single message renderer.
//
// Pure render over `message.parts`. We don't need real AI SDK types — the
// component switches on `part.type` strings, so hand-built literals are
// enough. We cast through `as DesignAgentUIMessage` to satisfy the prop type
// without dragging in the agent's full type machinery.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { ChatMsg } from '../ChatMsg';
import type { DesignAgentUIMessage } from '../ui-messages';
import { theme } from '@/theme/theme';

afterEach(() => cleanup());

function renderMsg(msg: unknown, props: Partial<Parameters<typeof ChatMsg>[0]> = {}): void {
  render(
    <ThemeProvider theme={theme}>
      <ChatMsg message={msg as DesignAgentUIMessage} {...props} />
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
          type: 'tool-write_file',
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
          type: 'tool-done',
          state: 'output-available',
          input: { summary: 'all done' },
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
          type: 'tool-write_file',
          state: 'output-available',
          input: { path: 'a' },
          toolCallId: 'c1',
        },
        {
          type: 'tool-write_file',
          state: 'input-streaming',
          input: { path: 'b' },
          toolCallId: 'c2',
        },
        {
          type: 'tool-write_file',
          state: 'input-available',
          input: { path: 'c' },
          toolCallId: 'c3',
        },
        {
          type: 'tool-write_file',
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

  it('falls back to type-derived verb for unknown tool types (full name, no truncation)', () => {
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
    // Regression guard for F1.2 — generic fallback used to slice(0, 8)
    // which produced 'CUSTOM_T'. We now show the full tool name, lowercase
    // with underscores → spaces, so users can read what the agent did.
    expect(screen.queryByText('CUSTOM_T')).toBeNull();
    expect(screen.getByText(/custom thing/i)).toBeInTheDocument();
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
                  type: 'tool-write_file',
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

  // ───── F1.2 — verb-map coverage for the tools we ship in v2 ─────
  // Regression guard for the post-merge e2e finding where `tool-write_file`
  // rendered as truncated `WRITE_FI` because no explicit case existed and
  // the generic fallback did `name.toUpperCase().slice(0, 8)`. Each row
  // below covers one branch of the verb map so a missing case fails loud.
  describe('verb-map (F1.2)', () => {
    it.each([
      // [tool type, input, expected verb (case-insensitive substring), expected target?]
      ['tool-write_file', { path: 'src/App.jsx' }, /writing/i, 'src/App.jsx'],
      ['tool-read_file', { path: 'src/Other.jsx' }, /reading/i, 'src/Other.jsx'],
      ['tool-str_replace_based_edit_tool', { path: 'src/App.jsx' }, /editing/i, 'src/App.jsx'],
      ['tool-list_files', { path: '/' }, /listing/i, '/'],
      ['tool-copy_files', { from: 'a', to: 'b' }, /copying/i, null],
      ['tool-delete_file', { path: 'tmp/x' }, /deleting/i, 'tmp/x'],
      ['tool-grep', { pattern: 'TODO' }, /grep/i, null],
      ['tool-view_image', { path: 'logo.png' }, /viewing/i, 'logo.png'],
      ['tool-web_fetch', { url: 'https://x.com' }, /fetching/i, 'https://x.com'],
      ['tool-done', { summary: 'all built' }, /done/i, 'all built'],
      ['tool-snip', { from_id: 'm1', to_id: 'm5' }, /snip/i, null],
      [
        'tool-update_todos',
        { todos: [{ id: '1', content: 'do it', status: 'pending' }] },
        /todos/i,
        null,
      ],
      ['tool-register_assets', { assets: [{ path: 'logo.png', kind: 'image' }] }, /assets/i, null],
      ['tool-invoke_skill', { name: 'wireframe' }, /skill/i, 'wireframe'],
      ['tool-fork_verifier_agent', { task: 'check' }, /verif/i, null],
      ['tool-verification_feedback', { verdict: 'done' }, /feedback/i, null],
      // Screenshot tools collapse to a single "SCREEN" en label for chat-row
      // compactness — the verb chip column is fixed-width and "SCREENSHOTTING"
      // would overflow. The regex matches both forms so locale labels are free
      // to spell it out where space permits.
      ['tool-screenshot', {}, /(screen|capture)/i, null],
      ['tool-screenshot_user_view', {}, /(screen|capture)/i, null],
      ['tool-eval_js', { code: 'foo()' }, /eval/i, null],
      ['tool-eval_js_user_view', { code: 'foo()' }, /eval/i, null],
      ['tool-get_webview_logs', {}, /logs/i, null],
      ['tool-multi_screenshot', {}, /(screen|capture)/i, null],
      // NOTE: tool-questions_v2 with output-available renders <QuestionsForm>
      // instead of a verb chip — covered by the dedicated questions_v2 (F1.1)
      // block, NOT this generic chip-rendering test row.
    ] as const)(
      '%s renders a useful verb chip (never the truncated upper-case slice)',
      (type, input, verbRe, target) => {
        renderMsg({
          id: `m-${type}`,
          role: 'assistant',
          parts: [
            {
              type,
              state: 'output-available',
              input,
              toolCallId: `c-${type}`,
            },
          ],
        });
        // Should NOT contain a truncated 8-char upper-case slice of the name
        // (the previous bug). e.g. WRITE_FI / STR_REPL / REGISTER.
        const trimmedFallback = type.slice(5).toUpperCase().slice(0, 8);
        // The trimmedFallback "WRITE_FI" etc. shouldn't appear as the verb cell.
        // Some tools (e.g. tool-grep → "GREP") happen to be ≤8 chars so the
        // trimmedFallback equals the real verb. Skip in that case.
        if (trimmedFallback.length === 8 && !verbRe.test(trimmedFallback)) {
          expect(screen.queryByText(trimmedFallback)).toBeNull();
        }
        // Either an explicit case verb or the lowercase-with-spaces fallback
        // must satisfy the verb regex.
        const verbMatches = screen.queryAllByText(verbRe);
        expect(verbMatches.length).toBeGreaterThan(0);
        if (target !== null) {
          expect(screen.queryAllByText(target).length).toBeGreaterThan(0);
        }
      },
    );

    it('explicitly does not render WRITE_FI for tool-write_file (F1.2 regression)', () => {
      renderMsg({
        id: 'm-regression',
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_file',
            state: 'output-available',
            input: { path: 'Hello World.html' },
            toolCallId: 'c1',
          },
        ],
      });
      expect(screen.queryByText('WRITE_FI')).toBeNull();
      expect(screen.getByText(/writing/i)).toBeInTheDocument();
      expect(screen.getByText('Hello World.html')).toBeInTheDocument();
    });
  });

  // ───── F1.1 — questions_v2 form wiring ─────
  // Regression guard for the post-merge e2e finding where `tool-questions_v2`
  // fell through to the generic fallback (rendering 'QUESTION' chip) instead
  // of mounting <QuestionsForm>. ChatMsg accepts callbacks so ChatPanel can
  // wire form submit → chat.sendMessage().
  describe('questions_v2 (F1.1)', () => {
    const formInput = {
      title: "Let's design something great for your startup",
      questions: [
        {
          id: 'audience',
          kind: 'text-options',
          title: 'Who is this for?',
          options: ['Designers', 'PMs', 'Engineers'],
        },
      ],
    };

    it('renders <QuestionsForm> for tool-questions_v2 in state=output-available', () => {
      renderMsg({
        id: 'm-q1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-questions_v2',
            state: 'output-available',
            input: formInput,
            toolCallId: 'c-q1',
          },
        ],
      });
      // Title from part.input.title should appear (rendered by QuestionsForm)
      expect(screen.getByText("Let's design something great for your startup")).toBeInTheDocument();
      // 3 options → 3 radio inputs from text-options
      expect(screen.getAllByRole('radio').length).toBe(3);
      // Submit + Cancel buttons present (form CTA)
      expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('does NOT render a generic "QUESTION ✓" chip for tool-questions_v2', () => {
      renderMsg({
        id: 'm-q2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-questions_v2',
            state: 'output-available',
            input: formInput,
            toolCallId: 'c-q2',
          },
        ],
      });
      // The truncated fallback used to render as 'QUESTION' (questions_v2
      // → upper(8) = 'QUESTION') as a verb chip. Asserting absence guards
      // against regression to the generic fallback path.
      expect(screen.queryByText('QUESTION')).toBeNull();
    });

    it('calls onSubmitQuestions with formatted answers when user submits', () => {
      const onSubmitQuestions = vi.fn();
      const onCancelQuestions = vi.fn();
      renderMsg(
        {
          id: 'm-q3',
          role: 'assistant',
          parts: [
            {
              type: 'tool-questions_v2',
              state: 'output-available',
              input: {
                title: 'X',
                questions: [{ id: 'q1', kind: 'freeform', title: 'Anything else?' }],
              },
              toolCallId: 'c-q3',
            },
          ],
        },
        { onSubmitQuestions, onCancelQuestions },
      );
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'hello world' } });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      expect(onSubmitQuestions).toHaveBeenCalledTimes(1);
      const [callId, text] = onSubmitQuestions.mock.calls[0]!;
      expect(callId).toBe('c-q3');
      // formatAnswers() returns JSON-style indented text the agent can parse
      expect(text).toContain('"q1"');
      expect(text).toContain('"hello world"');
    });

    it('calls onCancelQuestions when user clicks Cancel', () => {
      const onSubmitQuestions = vi.fn();
      const onCancelQuestions = vi.fn();
      renderMsg(
        {
          id: 'm-q4',
          role: 'assistant',
          parts: [
            {
              type: 'tool-questions_v2',
              state: 'output-available',
              input: formInput,
              toolCallId: 'c-q4',
            },
          ],
        },
        { onSubmitQuestions, onCancelQuestions },
      );
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onCancelQuestions).toHaveBeenCalledTimes(1);
      expect(onCancelQuestions.mock.calls[0]![0]).toBe('c-q4');
      expect(onSubmitQuestions).not.toHaveBeenCalled();
    });

    it('hides the form when handledToolCallIds includes the toolCallId', () => {
      renderMsg(
        {
          id: 'm-q5',
          role: 'assistant',
          parts: [
            {
              type: 'tool-questions_v2',
              state: 'output-available',
              input: formInput,
              toolCallId: 'c-q5',
            },
          ],
        },
        { handledToolCallIds: new Set(['c-q5']) },
      );
      // Form gone — title hidden, radios gone
      expect(screen.queryByText("Let's design something great for your startup")).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();
    });

    it('renders nothing distracting in state=input-streaming (form not ready)', () => {
      renderMsg({
        id: 'm-q6',
        role: 'assistant',
        parts: [
          {
            type: 'tool-questions_v2',
            state: 'input-streaming',
            // streaming → input may still be partial
            input: { title: 'partial' },
            toolCallId: 'c-q6',
          },
        ],
      });
      // No interactive radios while streaming
      expect(screen.queryByRole('radio')).toBeNull();
      // No Submit button while streaming
      expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    });
  });
});
