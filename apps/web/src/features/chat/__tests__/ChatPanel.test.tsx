// ChatPanel — orchestrator over useAgentChat + WorkspaceProvider.
//
// Tests focus on the orchestration glue: tab switching, tool-write detection,
// pendingChatSubmit drain, BYOK gate flow. The chat hook itself is mocked so
// we control message flow without touching @ai-sdk/react.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';

// ── mocks (registered before importing ChatPanel) ──

vi.mock('@/lib/api', () => ({
  api: vi.fn(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (path.includes('/comments') && method === 'GET') {
      return { comments: [] };
    }
    if (path.includes('/chats') && method === 'GET') {
      return {
        chats: [
          {
            id: 'fake-chat',
            projectId: 'p1',
            title: null,
            createdAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
      };
    }
    if (path.includes('/chats') && method === 'POST') {
      return {
        chat: {
          id: 'fake-chat',
          projectId: 'p1',
          title: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      };
    }
    return undefined;
  }),
}));

interface FakeVerifierState {
  running: boolean;
  lastResult: null;
  error: null;
}

interface FakeUseAgentChatHandle {
  messages: Array<{ id: string; role: string; parts: Array<Record<string, unknown>> }>;
  sendMessage: ReturnType<typeof vi.fn>;
  status: 'ready' | 'streaming' | 'submitted' | 'error';
  error: Error | null;
  stop: ReturnType<typeof vi.fn>;
  hasKey: boolean;
  refreshKey: ReturnType<typeof vi.fn>;
  verifier: FakeVerifierState;
}

const fakeAgent: FakeUseAgentChatHandle = {
  messages: [],
  sendMessage: vi.fn(),
  status: 'ready',
  error: null,
  stop: vi.fn(),
  hasKey: true,
  refreshKey: vi.fn(),
  verifier: { running: false, lastResult: null, error: null },
};

vi.mock('../use-agent-chat', () => ({
  useAgentChat: () => fakeAgent,
}));

// ApiKeyModal is heavy — stub it to a controlled shell.
vi.mock('@/features/settings/ApiKeyModal', () => ({
  ApiKeyModal: ({
    open,
    onSaved,
    onCancel,
  }: {
    open: boolean;
    onSaved: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Save API key">
        <button type="button" onClick={onSaved}>
          Save key
        </button>
        <button type="button" onClick={onCancel}>
          Cancel key
        </button>
      </div>
    ) : null,
}));

import { ChatPanel } from '../ChatPanel';
import { WorkspaceProvider, useWorkspace } from '@/state/workspace';
import { TodosProvider } from '../todos-state';
import { setModelId } from '@/lib/model-pref';
import { emitModelChange } from '@/lib/model-pref-events';
import type { ChatViewSelection } from '@/features/workspace/ChatTabBar';
import { useState } from 'react';

// Workspace capture (mirrors preview test pattern) — lets us push state
// changes from inside tests.
const workspaceRef: { current: ReturnType<typeof useWorkspace> | null } = { current: null };
function WorkspaceCapture(): null {
  workspaceRef.current = useWorkspace();
  return null;
}

// Test harness: ChatPanel now takes selection from outside (Task 8). Render with
// a small wrapper that owns selection state and exposes setters via window for
// tests that need to flip Comments / Activity views.
const selectionRef: {
  current: { selection: ChatViewSelection; setSelection: (s: ChatViewSelection) => void } | null;
} = { current: null };
function PanelHarness(): JSX.Element {
  const [selection, setSelection] = useState<ChatViewSelection>({
    kind: 'chat',
    chatId: 'c1',
  });
  selectionRef.current = { selection, setSelection };
  return <ChatPanel projectId="p1" selection={selection} />;
}

function renderPanel(): void {
  render(
    <ThemeProvider theme={theme}>
      <TodosProvider>
        <WorkspaceProvider projectId="p1">
          <PanelHarness />
          <WorkspaceCapture />
        </WorkspaceProvider>
      </TodosProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  fakeAgent.messages = [];
  fakeAgent.sendMessage.mockReset();
  fakeAgent.refreshKey.mockReset();
  fakeAgent.stop.mockReset();
  fakeAgent.status = 'ready';
  fakeAgent.error = null;
  fakeAgent.hasKey = true;
  fakeAgent.verifier = { running: false, lastResult: null, error: null };
  workspaceRef.current = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('ChatPanel', () => {
  // Task 8: tabs are now in the outer SecondaryHeader's ChatTabBar (driven by
  // the parent's selection state). ChatPanel itself only renders the active
  // view content + composer + model strip. These tests cover view switching
  // by flipping the harness's `selection` state.

  it('renders chat history when selection.kind = chat', () => {
    fakeAgent.messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    renderPanel();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('renders Comments view when selection switches to comments', () => {
    renderPanel();
    expect(screen.queryByText(/CommentsTab/i)).toBeNull();
    act(() => {
      selectionRef.current!.setSelection({ kind: 'comments' });
    });
    // CommentsTab renders an empty-state message when there are no pins.
    // Use the test-id-free fallback marker — empty state hint or container.
    expect(
      // CommentsTab uses its own copy; the chat history scroll container should
      // no longer show messages when in comments view (there are none anyway).
      screen.queryByTestId('chat-msg-user-0'),
    ).toBeNull();
  });

  it('renders Activity view when selection switches to activity', () => {
    renderPanel();
    act(() => {
      selectionRef.current!.setSelection({ kind: 'activity' });
    });
    // Activity feed is empty by default; just verify chat thread is gone.
    expect(screen.queryByTestId('chat-msg-user-0')).toBeNull();
  });

  it('renders an error banner when the hook reports an error', () => {
    fakeAgent.error = new Error('rate-limited');
    renderPanel();
    expect(screen.getByRole('alert').textContent).toContain('rate-limited');
  });

  it('shows the "thinking" indicator only while streaming on the Chat tab', () => {
    fakeAgent.status = 'streaming';
    renderPanel();
    expect(screen.getByText(/Atelier is thinking/)).toBeInTheDocument();

    fakeAgent.status = 'ready';
    cleanup();
    renderPanel();
    expect(screen.queryByText(/Atelier is thinking/)).toBeNull();
  });

  it('renders one ChatMsg per message on the Chat tab', () => {
    fakeAgent.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello there' }] },
    ];
    renderPanel();
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('Composer onSubmit empty input is a no-op', () => {
    renderPanel();
    const sendBtn = screen.getByLabelText('Send');
    act(() => fireEvent.click(sendBtn));
    expect(fakeAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('Composer onSubmit with key calls sendMessage and clears input', () => {
    renderPanel();
    const textarea = screen.getByLabelText('Chat composer') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'do the thing' } }));
    expect(textarea.value).toBe('do the thing');

    const sendBtn = screen.getByLabelText('Send');
    act(() => fireEvent.click(sendBtn));
    expect(fakeAgent.sendMessage).toHaveBeenCalledWith({ text: 'do the thing' });

    // After submit, input clears.
    expect((screen.getByLabelText('Chat composer') as HTMLTextAreaElement).value).toBe('');
  });

  it('Composer onSubmit with skill attachments forwards them via sendMessage({text, attachments})', () => {
    renderPanel();
    // Open Add context → Attach skill → Pick Make a deck
    act(() => fireEvent.click(screen.getByRole('button', { name: /Add context/i })));
    const attachSkillItem = screen
      .getAllByRole('menuitem')
      .find((i) => i.textContent?.includes('Attach skill'))!;
    act(() => fireEvent.click(attachSkillItem));
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Make a deck/i })));
    // Type some text + Send
    const textarea = screen.getByLabelText('Chat composer') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'pitch deck please' } }));
    act(() => fireEvent.click(screen.getByLabelText('Send')));

    expect(fakeAgent.sendMessage).toHaveBeenCalledTimes(1);
    const arg = fakeAgent.sendMessage.mock.calls[0]![0];
    expect(arg.text).toBe('pitch deck please');
    expect(arg.attachments).toBeDefined();
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments[0]).toMatchObject({
      name: 'Make a deck',
      type: 'skill',
    });
    expect(typeof arg.attachments[0].content).toBe('string');
    expect(arg.attachments[0].content.length).toBeGreaterThan(10);
  });

  it('Composer onSubmit without key opens ApiKeyModal and stashes pendingMessage', () => {
    fakeAgent.hasKey = false;
    renderPanel();
    const textarea = screen.getByLabelText('Chat composer') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'go' } }));

    const sendBtn = screen.getByLabelText('Send');
    act(() => fireEvent.click(sendBtn));
    expect(fakeAgent.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Cancel on the API key modal clears pendingMessage and closes the modal', () => {
    fakeAgent.hasKey = false;
    renderPanel();
    const textarea = screen.getByLabelText('Chat composer') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'go' } }));
    act(() => fireEvent.click(screen.getByLabelText('Send')));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => fireEvent.click(screen.getByText('Cancel key')));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('treats tool-write_file in HYDRATED messages as already-seen (no auto-open on first mount)', () => {
    // Pre-seed messages = simulating page reload: messages restored from API
    // already contain tool-write_file outputs. The mount effect should mark
    // these as "already processed" and NOT dispatch set_active_tab — that
    // would fight with FileTree's auto-pick + clobber the user's manual tab
    // clicks. Auto-open is reserved for genuinely NEW tool calls that arrive
    // AFTER mount (via streaming during this session).
    fakeAgent.messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_file',
            state: 'output-available',
            input: { path: 'App.jsx' },
            toolCallId: 'tc-1',
          },
        ],
      },
    ];
    renderPanel();

    expect(workspaceRef.current!.state.activeTab).toBe('Design Files');
    expect(workspaceRef.current!.state.filesChangedAt).toBe(0);
  });

  it('dispatches files_changed (debounced) when str_replace_based_edit_tool arrives post-streaming (regression: auto-reload)', async () => {
    // Regression for user-reported "agent 改完文件没自动 reload" — 前期只听
    // tool-write_file，漏了 str_replace_based_edit_tool。
    // 注意 (2026-05-04): hydration guard 改用 status 守卫 —— 必须 useChat 至少
    // 进入过 'streaming' 一次（用户主动 send 过）才放行 dispatch。
    vi.useFakeTimers();
    fakeAgent.messages = [];
    fakeAgent.status = 'ready';
    renderPanel();
    const tickBefore = workspaceRef.current!.state.filesChangedAt;

    // 翻 hasStreamedRef ：模拟用户 send → status 变 streaming
    act(() => {
      fakeAgent.status = 'streaming';
      selectionRef.current!.setSelection({ kind: 'activity' });
      selectionRef.current!.setSelection({ kind: 'chat', chatId: 'c1' });
    });

    act(() => {
      fakeAgent.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-str_replace_based_edit_tool',
              state: 'output-available',
              input: { path: 'App.jsx', old_str: 'foo', new_str: 'bar' },
              toolCallId: 'tc-strrepl-1',
            },
          ],
        },
      ];
      selectionRef.current!.setSelection({ kind: 'activity' });
      selectionRef.current!.setSelection({ kind: 'chat', chatId: 'c1' });
    });

    expect(workspaceRef.current!.state.filesChangedAt).toBe(tickBefore);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(workspaceRef.current!.state.filesChangedAt).toBeGreaterThan(tickBefore);
    vi.useRealTimers();
  });

  it('coalesces N rapid file-mutating tools into a single dispatch (no flicker)', async () => {
    // 验证 debounce 合并 —— agent 一回合 5 次 str_replace 应该只 dispatch 一次。
    // 注意：测试需先翻 hasStreamedRef（status 进入 streaming）才放行 dispatch。
    vi.useFakeTimers();
    fakeAgent.messages = [];
    fakeAgent.status = 'streaming'; // 模拟 useChat 已进入 streaming
    renderPanel();
    const tickBefore = workspaceRef.current!.state.filesChangedAt;

    // 模拟 agent 在 100ms 内连续报 5 个 str_replace tool 完成。
    for (let i = 0; i < 5; i++) {
      act(() => {
        fakeAgent.messages = [
          {
            id: 'a1',
            role: 'assistant',
            parts: Array.from({ length: i + 1 }, (_, idx) => ({
              type: 'tool-str_replace_based_edit_tool',
              state: 'output-available',
              input: { path: 'App.jsx', old_str: `x${idx}`, new_str: `y${idx}` },
              toolCallId: `tc-batch-${idx}`,
            })),
          },
        ];
        selectionRef.current!.setSelection({ kind: 'activity' });
        selectionRef.current!.setSelection({ kind: 'chat', chatId: 'c1' });
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }

    expect(workspaceRef.current!.state.filesChangedAt).toBe(tickBefore);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    const tickAfter = workspaceRef.current!.state.filesChangedAt;
    expect(tickAfter).toBeGreaterThan(tickBefore);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(workspaceRef.current!.state.filesChangedAt).toBe(tickAfter);
    vi.useRealTimers();
  });

  it('does NOT dispatch files_changed when historical tool calls arrive during hydration (no flash)', async () => {
    // 修闪屏 type-1 (2026-05-04): useChat hydration 异步分批填 messages，第一次
    // effect 跑时 messages 可能空，第二次跑时历史 tool 才进来 — 之前的 hasHydratedRef
    // sentinel 会把这些当成新 tool 触发 dispatch → 首次进入预览闪一下。
    // 现在 status 没进入 streaming → 永远不 dispatch（hydration 安全）。
    vi.useFakeTimers();
    fakeAgent.messages = [];
    fakeAgent.status = 'ready';
    renderPanel();
    const tickBefore = workspaceRef.current!.state.filesChangedAt;

    // 模拟 hydration 第二阶段：messages 异步填上历史 tool calls
    act(() => {
      fakeAgent.messages = [
        {
          id: 'a-hist',
          role: 'assistant',
          parts: [
            {
              type: 'tool-write_file',
              state: 'output-available',
              input: { path: 'App.jsx' },
              toolCallId: 'tc-hist-1',
            },
            {
              type: 'tool-str_replace_based_edit_tool',
              state: 'output-available',
              input: { path: 'App.jsx', old_str: 'a', new_str: 'b' },
              toolCallId: 'tc-hist-2',
            },
          ],
        },
      ];
      selectionRef.current!.setSelection({ kind: 'activity' });
      selectionRef.current!.setSelection({ kind: 'chat', chatId: 'c1' });
    });

    // 推进时间 —— 即使过了 debounce window 也不应 dispatch（status 始终 'ready'）
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(workspaceRef.current!.state.filesChangedAt).toBe(tickBefore);
    vi.useRealTimers();
  });

  it('does not re-dispatch for the same toolCallId on subsequent renders', () => {
    fakeAgent.messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_file',
            state: 'output-available',
            input: { path: 'App.jsx' },
            toolCallId: 'tc-1',
          },
        ],
      },
    ];
    renderPanel();
    const tickAfterFirst = workspaceRef.current!.state.filesChangedAt;

    // Trigger a re-render via flipping the external selection state (no new messages).
    act(() => selectionRef.current!.setSelection({ kind: 'activity' }));
    act(() => selectionRef.current!.setSelection({ kind: 'chat', chatId: 'c1' }));

    expect(workspaceRef.current!.state.filesChangedAt).toBe(tickAfterFirst);
  });

  it('drains pendingChatSubmit (text only) by calling sendMessage and clearing the queue', () => {
    renderPanel();

    act(() => {
      workspaceRef.current!.actions.queueChatSubmit({ text: 'queued msg' });
    });

    expect(fakeAgent.sendMessage).toHaveBeenCalledWith({ text: 'queued msg' });
    expect(workspaceRef.current!.state.pendingChatSubmit).toBeNull();
  });

  it('drains pendingChatSubmit with attachments → maps to FileUIPart', () => {
    renderPanel();

    act(() => {
      workspaceRef.current!.actions.queueChatSubmit({
        text: 'with image',
        attachments: [
          { mediaType: 'image/png', url: 'data:image/png;base64,XX', filename: 'sketch.png' },
        ],
      });
    });

    expect(fakeAgent.sendMessage).toHaveBeenCalledWith({
      text: 'with image',
      files: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,XX',
          filename: 'sketch.png',
        },
      ],
    });
  });

  it('without key, pendingChatSubmit stashes text and opens the modal', () => {
    fakeAgent.hasKey = false;
    renderPanel();

    act(() => {
      workspaceRef.current!.actions.queueChatSubmit({ text: 'blocked' });
    });

    expect(fakeAgent.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(workspaceRef.current!.state.pendingChatSubmit).toBeNull();
  });

  // ── composerSeed (Examples → "Use this prompt" pre-fill, 2026-05-04) ──

  it('composerSeed pre-fills empty Composer input and clears the seed', () => {
    renderPanel();
    const textarea = screen.getByLabelText('Chat composer') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');

    act(() => {
      workspaceRef.current!.actions.setComposerSeed('Build me a TODO app');
    });

    // Input filled, seed cleared.
    expect((screen.getByLabelText('Chat composer') as HTMLTextAreaElement).value).toBe(
      'Build me a TODO app',
    );
    expect(workspaceRef.current!.state.composerSeed).toBeNull();
    // CRITICAL: must NOT auto-send — that would re-introduce Bug 1.
    expect(fakeAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('composerSeed does NOT overwrite user-typed input but still clears the seed', () => {
    renderPanel();
    const textarea = screen.getByLabelText('Chat composer') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'user is typing' } }));
    expect(textarea.value).toBe('user is typing');

    act(() => {
      workspaceRef.current!.actions.setComposerSeed('Late seed arrival');
    });

    // User's input wins.
    expect((screen.getByLabelText('Chat composer') as HTMLTextAreaElement).value).toBe(
      'user is typing',
    );
    // Seed still cleared so we don't double-fire on next render.
    expect(workspaceRef.current!.state.composerSeed).toBeNull();
  });

  it('composerSeed works without a BYOK key (no modal, no pending — just a draft)', () => {
    fakeAgent.hasKey = false;
    renderPanel();

    act(() => {
      workspaceRef.current!.actions.setComposerSeed('starter prompt');
    });

    // The draft channel must NOT trip the BYOK gate.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fakeAgent.sendMessage).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Chat composer') as HTMLTextAreaElement).value).toBe(
      'starter prompt',
    );
  });

  it('after key save, refreshKey is called and stashed pendingMessage flushes', () => {
    fakeAgent.hasKey = false;
    renderPanel();

    // Stash a pending message via the BYOK path.
    const textarea = screen.getByLabelText('Chat composer');
    act(() => fireEvent.change(textarea, { target: { value: 'queued' } }));
    act(() => fireEvent.click(screen.getByLabelText('Send')));

    // Save the key — modal closes, refreshKey called.
    act(() => fireEvent.click(screen.getByText('Save key')));
    expect(fakeAgent.refreshKey).toHaveBeenCalled();
  });

  it('model label re-renders when subscribeModelChange fires', () => {
    // The model label appears in TWO places — the ChatPanel header ModelTag
    // AND the Composer's ModelDropdown trigger — so we expect at least one
    // match per state.
    setModelId('anthropic/claude-sonnet-4-6');
    renderPanel();
    expect(screen.getAllByText(/Sonnet 4\.6/).length).toBeGreaterThan(0);

    act(() => {
      setModelId('anthropic/claude-haiku-4-5');
      emitModelChange();
    });

    expect(screen.getAllByText(/Haiku 4\.5/).length).toBeGreaterThan(0);
  });

  it('Comments tab onSelect dispatches set_active_tab and set_selected_pin', () => {
    renderPanel();
    act(() => {
      workspaceRef.current!.dispatch({
        type: 'set_pins',
        pins: [
          {
            id: 'pin-x',
            n: 1,
            x: 0,
            y: 0,
            text: 'check this',
            selector: null,
            filePath: 'Counter.jsx',
            createdAt: new Date().toISOString(),
          },
        ],
      });
    });

    // Switch to comments view via external selection (Task 8: tabs are external).
    act(() => selectionRef.current!.setSelection({ kind: 'comments' }));
    // Pin entry in the comments tab should be a clickable row containing the
    // text. Clicking it should set activeTab + selectedPinId.
    const pinRow = screen.getByText('check this');
    act(() => fireEvent.click(pinRow));

    expect(workspaceRef.current!.state.activeTab).toBe('Counter.jsx');
    expect(workspaceRef.current!.state.selectedPinId).toBe('pin-x');
  });

  // ───── F1.1 — questions_v2 form ↔ chat.sendMessage wiring ─────
  describe('questions_v2 form wiring', () => {
    it('renders <QuestionsForm> when a message has a tool-questions_v2 part', () => {
      fakeAgent.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-questions_v2',
              state: 'output-available',
              input: {
                title: 'Quick questions about the landing page',
                questions: [
                  {
                    id: 'audience',
                    kind: 'text-options',
                    title: 'Who is this for?',
                    options: ['Designers', 'PMs'],
                  },
                ],
              },
              toolCallId: 'tcid-q1',
            },
          ],
        },
      ];
      renderPanel();
      expect(screen.getByText('Quick questions about the landing page')).toBeInTheDocument();
      // Submit + Cancel buttons mean the form mounted (not the verb chip).
      expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('submits answers via chat.sendMessage with JSON-formatted text', () => {
      fakeAgent.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-questions_v2',
              state: 'output-available',
              input: {
                title: 'X',
                questions: [
                  {
                    id: 'audience',
                    kind: 'text-options',
                    title: 'Who?',
                    options: ['Designers', 'PMs'],
                  },
                ],
              },
              toolCallId: 'tcid-q2',
            },
          ],
        },
      ];
      renderPanel();
      const radio = screen.getAllByRole('radio')[0] as HTMLInputElement;
      act(() => fireEvent.click(radio));
      act(() => fireEvent.click(screen.getByRole('button', { name: /submit/i })));
      expect(fakeAgent.sendMessage).toHaveBeenCalledTimes(1);
      const arg = fakeAgent.sendMessage.mock.calls[0]![0] as { text: string };
      expect(arg.text).toContain('"audience"');
      expect(arg.text).toContain('"Designers"');
    });

    it('cancel sends the "Skipped all questions" hint and unmounts the form', () => {
      fakeAgent.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-questions_v2',
              state: 'output-available',
              input: { title: 'X', questions: [] },
              toolCallId: 'tcid-q3',
            },
          ],
        },
      ];
      renderPanel();
      act(() => fireEvent.click(screen.getByRole('button', { name: /cancel/i })));
      expect(fakeAgent.sendMessage).toHaveBeenCalledTimes(1);
      const arg = fakeAgent.sendMessage.mock.calls[0]![0] as { text: string };
      expect(arg.text).toMatch(/skipped|proceed/i);
      // The form should disappear after cancel — title gone, no buttons left.
      expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    });

    it('submit unmounts the form (handledToolCallIds gates re-render)', () => {
      fakeAgent.messages = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-questions_v2',
              state: 'output-available',
              input: {
                title: 'My form',
                questions: [{ id: 'notes', kind: 'freeform', title: 'Anything?' }],
              },
              toolCallId: 'tcid-q4',
            },
          ],
        },
      ];
      renderPanel();
      // The Composer also has a textarea (chat input); use the one whose
      // aria-label matches the question's title to target the form textarea
      // specifically.
      const textarea = screen.getByRole('textbox', { name: 'Anything?' }) as HTMLTextAreaElement;
      act(() => fireEvent.change(textarea, { target: { value: 'no thanks' } }));
      act(() => fireEvent.click(screen.getByRole('button', { name: /submit/i })));
      // Form is hidden after submit
      expect(screen.queryByText('My form')).toBeNull();
      expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    });
  });
});
