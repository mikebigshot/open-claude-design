// Top-level chat panel. Mirrors prototype `proto-chat.jsx` ProtoChat.
//
// Task 8 顶部布局重构 + Task 2 多 chat 支持：
//   - Chat / Comments / Activity 三个内部 tabs 抽到外层 ChatTabBar（在
//     第二行的 SecondaryHeader 里）。
//   - ChatPanel 接受 selection prop（discriminated union），按 selection.kind
//     展示 Chat thread / Comments / Activity 视图。
//   - 多 chat 支持：useAgentChat 接 workspaceState.activeChatId；切 chat 时
//     useChat 实例由 chatId 强制重建，messages 自动 hydrate 当前 chat。
//
// Data source: useAgentChat (Vercel AI SDK ToolLoopAgent + BYOK key).
// Input state is managed externally (useChat v6 dropped managed input).
// ApiKeyModal is shown when no key is present.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled, { useTheme } from 'styled-components';
import type { ChatModel, Fidelity } from '@open-design/contracts';
import { ApiKeyModal } from '@/features/settings/ApiKeyModal';
import { useT } from '@/i18n';
import type { PendingAttachment } from '@/state/types';
import { useWorkspace } from '@/state/workspace';
import type { ChatViewSelection } from '@/features/workspace/ChatTabBar';
import { ActivityTab } from './ActivityTab';
import { buildActivityEntries } from './activity-builder';
import { ChatMsg } from './ChatMsg';
import { CommentsTab, aggregateSelectedPins } from './CommentsTab';
import { Composer } from './Composer';
import { IconLogo, IconSparkle } from './icons';
import { useAgentChat } from './use-agent-chat';

// ───── styled components ─────

const Panel = styled.aside`
  width: 420px;
  background: ${(p) => p.theme.colors.bg100};
  border-right: 1px solid ${(p) => p.theme.colors.line100};
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
`;

const Scroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
`;

const ThinkingRow = styled.div`
  font-size: 13px;
  color: ${(p) => p.theme.colors.fg300};
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
`;

const Caret = styled.span`
  display: inline-block;
  animation: blink 1s steps(2, start) infinite;
  @keyframes blink {
    to {
      visibility: hidden;
    }
  }
`;

const ErrorBanner = styled.div`
  margin: 0 18px 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: ${(p) => p.theme.colors.bg200};
  border: 1px solid ${(p) => p.theme.colors.danger};
  color: ${(p) => p.theme.colors.danger};
  font-size: 12px;
`;

// ───── props ─────

export interface ChatPanelProps {
  projectId: string;
  /**
   * 当前在第二行 SecondaryHeader 选中的视图（chat thread / comments / activity）。
   * Task 8 拆出 TabBar 后，由外部驱动；ChatPanel 自己不再持有 tab state。
   */
  selection: ChatViewSelection;
  /** Wireframe vs high-fidelity generation hint passed to system prompt. */
  fidelity?: Fidelity;
  designSystemId?: string;
  designSystemName?: string;
  designSystemTokensCss?: string;
}

// ───── component ─────

export function ChatPanel({
  projectId,
  selection,
  fidelity = 'high',
  designSystemId,
  designSystemName,
  designSystemTokensCss,
}: ChatPanelProps) {
  // ── workspace dispatch (for file-change notifications) + pins (single source) ──
  const { state: workspaceState, dispatch, actions } = useWorkspace();
  const theme = useTheme();
  const t = useT();

  // ── agent chat ──
  const { messages, sendMessage, status, error, stop, hasKey, refreshKey, verifier } = useAgentChat(
    {
      projectId,
      // Active chat from workspace state (Task 2)。null = chats 还在 hydrate；
      // useAgentChat 内部 hydration effect 会 skip。
      chatId: workspaceState.activeChatId,
      fidelity,
      designSystemId,
      designSystemName,
      designSystemTokensCss,
    },
  );

  // Track which tool calls we've already processed (to avoid re-dispatching on
  // every render). Reads from useChat messages.
  //
  // Side effects MUST only fire for tool calls that originated from STREAMING
  // in this session — never from API hydration. The signal: chat.status. While
  // 'streaming' / 'submitted', any new tool-write_file is genuinely from this
  // session. While 'ready', either nothing new is happening OR a hydrated
  // batch just arrived; either way we just record the toolCallIds as "seen"
  // and skip dispatch.
  //
  // P0-1 fix (2026-05-03): Removed the per-tool `set_active_tab(path)` dispatch.
  // Setting activeTab to a file path (e.g. 'App.jsx') routed Workspace.tsx to
  // FileSourceView (source code) instead of the live iframe Preview, which is
  // the opposite of what users expect after generation completes ("show me
  // the running app, not the code"). Now we only mark `files_changed` so
  // FileTree / PreviewPanel re-fetch; FileTree's own auto-pick effect
  // (FileTree.tsx line 247-264) lands first-time visitors on PREVIEW_TAB.
  //
  // P0-3 fallout: Without ChatPanel fighting FileTree for activeTab, the
  // "Design Files tab needs two clicks" race goes away — only one source of
  // truth (FileTree.autoPickedProjects guard) controls auto-navigation now.
  const processedToolCallsRef = useRef<Set<string>>(new Set());
  // Hydration guard 改造（2026-05-04 修闪屏 type-1）：
  // 之前用"第一次 effect 是 hydration"的 sentinel —— 但 useChat 的 messages 是
  // **异步分批填充**，第一次 effect 跑时 messages 可能还是空数组，hasHydratedRef
  // 已被 set true；第二次 effect 跑时历史 tool calls 才进来 → 被错误当成
  // post-hydration 新增 → schedulePendingDispatch → 500ms 后 dispatch
  // files_changed → iframe re-key → **首次进入预览闪一下**。
  // 改用 status 守卫：useChat 在用户主动 send 之前永远是 'ready'；只要从未进入
  // streaming/submitted，所有 tool 都视为 hydration 标 seen 不 dispatch。一旦
  // 进过 streaming，hasStreamedRef 永久 true，之后所有新 tool 触发 dispatch。
  const hasStreamedRef = useRef(false);

  // 所有"修改文件系统"的 tool —— agent 任一调用完成都要让预览自动 reload。
  // 之前只监听 tool-write_file，漏了 str_replace_based_edit_tool（改现有文件 ——
  // 实际生产中比 write_file 更常见！），导致用户改第二次起预览不更新。
  // 也包括 delete / copy 因为这些会改 file tree。
  const FILE_MUTATING_TOOL_TYPES = new Set([
    'tool-write_file',
    'tool-str_replace_based_edit_tool',
    'tool-delete_file',
    'tool-copy_files',
  ]);

  // Debounce + stream-end flush —— agent 一回合常连续调 N 次 str_replace 改
  // 多处代码，每次完成都立即 dispatch 会让 iframe (key=filesChangedAt) unmount/
  // remount N 次 → 闪屏 N 次。改用 debounce：
  //   - 任一 tool 完成 → schedule 500ms 后 dispatch
  //   - 500ms 内又来一个 tool → reset timer
  //   - status 从 streaming 变 ready (一回合彻底完成) → 立即 flush 不等剩余 ms
  // 效果：连续改 5 处只闪一次，且最迟 500ms 后用户就能看到结果。
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchPendingRef = useRef(false);
  const FLUSH_DEBOUNCE_MS = 500;

  const flushPendingDispatch = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (dispatchPendingRef.current) {
      dispatchPendingRef.current = false;
      dispatch({ type: 'files_changed' });
    }
  }, [dispatch]);

  const schedulePendingDispatch = useCallback(() => {
    dispatchPendingRef.current = true;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      if (!dispatchPendingRef.current) return;
      dispatchPendingRef.current = false;
      dispatch({ type: 'files_changed' });
    }, FLUSH_DEBOUNCE_MS);
  }, [dispatch]);

  // 监听 status —— 一旦进入 streaming 永久翻 hasStreamedRef = true。
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') {
      hasStreamedRef.current = true;
    }
  }, [status]);

  useEffect(() => {
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (!FILE_MUTATING_TOOL_TYPES.has(part.type)) continue;
        if ((part as { state?: string }).state !== 'output-available') continue;
        const toolCallId = (part as { toolCallId: string }).toolCallId;
        if (processedToolCallsRef.current.has(toolCallId)) continue;
        processedToolCallsRef.current.add(toolCallId);
        // 还没 streamed 过 → 仍在 hydration 阶段，不 dispatch（避免首次进入闪屏）
        if (!hasStreamedRef.current) continue;
        schedulePendingDispatch();
      }
    }
  }, [messages, schedulePendingDispatch]);

  // Stream 结束（status: streaming/submitted → ready）时立即 flush，不必等剩余
  // debounce 时间 —— agent 已经停手，没必要再让用户多等 500ms。
  useEffect(() => {
    const isStreamActive = status === 'streaming' || status === 'submitted';
    if (!isStreamActive && dispatchPendingRef.current) {
      flushPendingDispatch();
    }
  }, [status, flushPendingDispatch]);

  // unmount cleanup —— 防止 timer 在卸载后继续 fire dispatch（component dead）
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  // ── input (external state — useChat v6 dropped managed input) ──
  const [input, setInput] = useState('');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  // Drain workspace.composerSeed → Composer input. Set by ExamplesTab "Use
  // this prompt" path (Workspace mount effect reads sessionStorage and calls
  // setComposerSeed). NEVER auto-sent — user reviews and submits manually
  // (avoids the BYOK race that would drop messages on KeyModal cancel).
  //
  // Guard: don't overwrite user's in-progress typing. If the user opened the
  // example flow in another tab and started typing here in the meantime,
  // their input wins; we still clear the seed so we don't double-fire later.
  // `input` is intentionally excluded from deps — we only want to react to
  // a seed change, not every keystroke. The empty-input guard reads `input`
  // at the moment seed arrives, which is the correct semantics. Use a ref
  // to read input without making it a dep.
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);
  useEffect(() => {
    const seed = workspaceState.composerSeed;
    if (!seed) return;
    if (inputRef.current === '') {
      setInput(seed);
    }
    actions.clearComposerSeed();
  }, [workspaceState.composerSeed, actions]);

  // Activity tab feed: derived from messages (tool calls) + pins (comments).
  // (`pins` is also bound below for the Comments tab; both branches read the
  // same workspace slice.)
  const activityEntries = useMemo(
    () => buildActivityEntries(messages, workspaceState.pins, theme),
    [messages, workspaceState.pins, theme],
  );

  // Lazy chat 写入 —— 如果当前 active chat 是 pending（前端 placeholder），
  // 在发送任何 message 前先 POST /chats 把它落到 server。失败时不发 message
  // （后续 PUT /messages 用未存在的 chatId 必败），并 toast 通知用户。
  const sendMessageWithMaterialize = useCallback(
    async (input: Parameters<typeof sendMessage>[0]) => {
      const chatId = workspaceState.activeChatId;
      if (chatId) {
        const chat = workspaceState.chats?.find((c) => c.id === chatId);
        if (chat?.isPending) {
          try {
            await actions.materializeChat(chatId);
          } catch (err) {
            console.error('[chat] materializeChat failed', err);
            // showToast 在 workspace.tsx 内有同名 export
            // (lazy import 避免循环) —— 这里直接用 console + 不发消息阻断。
            return;
          }
        }
      }
      sendMessage(input);
    },
    [actions, sendMessage, workspaceState.activeChatId, workspaceState.chats],
  );

  // After saving a key, retry the message that was blocked.
  useEffect(() => {
    if (hasKey && pendingMessage !== null) {
      void sendMessageWithMaterialize({ text: pendingMessage });
      setPendingMessage(null);
    }
  }, [hasKey, pendingMessage, sendMessageWithMaterialize]);

  // Drain queued submissions from PreviewPanel (Draw screenshot, Pin "Send to Atelier").
  // Convert PendingAttachment → FileUIPart at the boundary so workspace state stays
  // free of `ai` package types. If no key yet, stash text in pendingMessage so the
  // BYOK gate path picks it up after key is set (attachments dropped in that path —
  // edge case: rare, sketch can be re-sent).
  useEffect(() => {
    const submit = workspaceState.pendingChatSubmit;
    if (!submit) return;
    if (!hasKey) {
      setPendingMessage(submit.text);
      setShowKeyModal(true);
      actions.queueChatSubmit(null);
      return;
    }
    if (submit.attachments && submit.attachments.length > 0) {
      const files = submit.attachments.map((a) => ({
        type: 'file' as const,
        mediaType: a.mediaType,
        url: a.url,
        ...(a.filename ? { filename: a.filename } : {}),
      }));
      void sendMessageWithMaterialize({ text: submit.text, files });
    } else {
      void sendMessageWithMaterialize({ text: submit.text });
    }
    actions.queueChatSubmit(null);
  }, [workspaceState.pendingChatSubmit, hasKey, sendMessageWithMaterialize, actions]);

  const submit = (text: string, attachments: PendingAttachment[] = []) => {
    if (!text.trim()) return;
    if (!hasKey) {
      // BYOK gate path doesn't carry attachments through KeyModal — they'd be
      // tied to a stale data-URL render anyway. This is the same trade-off
      // PendingChatSubmit makes on line 321 when queued submits hit a missing
      // key (text only, attachments dropped). Rare edge case; user re-pastes.
      setPendingMessage(text);
      setShowKeyModal(true);
      return;
    }
    if (attachments.length > 0) {
      const files = attachments.map((a) => ({
        type: 'file' as const,
        mediaType: a.mediaType,
        url: a.url,
        ...(a.filename ? { filename: a.filename } : {}),
      }));
      void sendMessageWithMaterialize({ text, files });
    } else {
      void sendMessageWithMaterialize({ text });
    }
    setInput('');
  };

  const isStreaming = status === 'streaming' || status === 'submitted';

  // ── view selection / scroll ──
  // selection.kind 'chat' = current chat thread view；其他 kind 走对应虚拟 tab。
  const isChatView = selection.kind === 'chat';
  const isCommentsView = selection.kind === 'comments';
  const isActivityView = selection.kind === 'activity';
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isChatView) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, isChatView]);

  // Pins live in workspace.state.pins (hydrated from /api/projects/:id/comments,
  // optimistically updated by actions.addPin / removePin in PreviewPanel + here).
  const pins = workspaceState.pins;

  // 用户需求 (e)：顶部 ModelStrip 已删，modelLabel state 不再需要。Composer 底部
  // ModelChip 自己读 model-pref，无需 ChatPanel 转发。
  const handleModelChange = useCallback((_model: ChatModel) => {
    void _model;
  }, []);

  return (
    <>
      <Panel>
        {/* 用户需求 (e)：顶部不再显示模型名 chip。模型选择仍在 Composer 底部 (ModelChip)。*/}

        {error && <ErrorBanner role="alert">{error.message}</ErrorBanner>}

        <Scroll ref={scrollRef} data-testid="chat-history">
          {isChatView && (
            <>
              {messages.map((msg, idx) => (
                <div key={msg.id} data-testid={`chat-msg-${msg.role}-${idx}`} data-msg-id={msg.id}>
                  <ChatMsg message={msg} />
                </div>
              ))}
              {isStreaming && (
                <ThinkingRow>
                  <IconLogo size={11} /> {t('chat.thinking')}
                  <Caret>▌</Caret>
                </ThinkingRow>
              )}
              {verifier.running && (
                <ThinkingRow role="status" aria-label="Verifier running">
                  <IconSparkle size={11} /> {t('chat.verifierChecking')}
                  <Caret>▌</Caret>
                </ThinkingRow>
              )}
            </>
          )}
          {isCommentsView && (
            <CommentsTab
              pins={pins.map((p) => ({
                id: p.id,
                n: p.n,
                text: p.text,
                createdAt: p.createdAt,
                filePath: p.filePath ?? null,
                selector: p.selector ?? null,
              }))}
              loadError={workspaceState.commentsError}
              onDelete={(id) => actions.removePin(id)}
              onSelect={(id, filePath) => {
                if (filePath) dispatch({ type: 'set_active_tab', tab: filePath });
                dispatch({ type: 'set_selected_pin', id });
              }}
              selectedIds={workspaceState.selectedPinIds}
              onToggleSelection={(id) => dispatch({ type: 'toggle_pin_selection', id })}
              onSendSelected={(note) => {
                const aggregated = aggregateSelectedPins(
                  pins.map((p) => ({
                    id: p.id,
                    n: p.n,
                    text: p.text,
                    createdAt: p.createdAt,
                    filePath: p.filePath ?? null,
                    selector: p.selector ?? null,
                  })),
                  workspaceState.selectedPinIds,
                  note,
                  t,
                );
                if (!aggregated.trim()) return;
                actions.queueChatSubmit({ text: aggregated });
                dispatch({ type: 'clear_pin_selection' });
              }}
            />
          )}
          {isActivityView && <ActivityTab entries={activityEntries} />}
        </Scroll>

        <Composer
          projectId={projectId}
          value={input}
          onChange={setInput}
          onSubmit={(attachments) => submit(input, attachments)}
          onStop={stop}
          streaming={isStreaming}
          onModelChange={handleModelChange}
        />
      </Panel>

      {showKeyModal && (
        <ApiKeyModal
          open
          onSaved={() => {
            setShowKeyModal(false);
            refreshKey();
          }}
          onCancel={() => {
            setShowKeyModal(false);
            setPendingMessage(null);
          }}
        />
      )}
    </>
  );
}
