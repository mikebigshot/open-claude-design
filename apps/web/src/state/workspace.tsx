// WorkspaceProvider + useWorkspace hook
//
// 给 chat / preview agent 通过 useWorkspace() 拿 state + dispatch。
// 状态形状定义在 ./types.ts，本文件只负责 provider/reducer 接线。

import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';

import type {
  CreateChatRequest,
  CreateChatResponse,
  ListChatsResponse,
  ListCommentsResponse,
  PatchChatRequest,
  PatchChatResponse,
} from '@open-design/contracts';
import { api } from '../lib/api';
import { showToast } from '../components/Toast';
import type {
  ActiveTab,
  CommentPin,
  DrawShape,
  DrawStroke,
  EditState,
  LocalChat,
  PendingChatSubmit,
  Tool,
  WorkspaceAction,
  WorkspaceState,
} from './types';
import { DESIGN_FILES_TAB } from './types';

// Re-export 给消费者一站式 import 用
export { DESIGN_FILES_TAB, PREVIEW_TAB } from './types';

// ───── 默认 state ─────

const DEFAULT_EDIT: EditState = {
  bg: '#FAF9F5',
  font: 'Inter',
  base: 15,
  headingSize: 26,
};

export function makeInitialState(projectId: string, readOnly = false): WorkspaceState {
  return {
    projectId,
    openTabs: [],
    activeTab: DESIGN_FILES_TAB,
    tool: null,
    pins: [],
    drawingPin: null,
    selectedPinIds: [],
    commentsError: null,
    importOpen: false,
    modelOpen: false,
    edit: { ...DEFAULT_EDIT },
    drawStrokes: [],
    drawing: null,
    drawSubMode: 'draw',
    readOnly,
    filesChangedAt: 0,
    pendingChatSubmit: null,
    selectedPinId: null,
    zoom: 'fit',
    previewingFile: null,
    autoPickDone: false,
    chats: null,
    activeChatId: null,
    chatsError: null,
    composerSeed: null,
  };
}

// ───── reducer ─────

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'open_file': {
      const exists = state.openTabs.includes(action.name);
      return {
        ...state,
        openTabs: exists ? state.openTabs : [...state.openTabs, action.name],
        activeTab: action.name,
      };
    }
    case 'close_tab': {
      const idx = state.openTabs.indexOf(action.name);
      if (idx === -1) return state;
      const next = state.openTabs.filter((t) => t !== action.name);
      let activeTab: ActiveTab = state.activeTab;
      if (state.activeTab === action.name) {
        // 选 idx-1，否则选第一个，否则回 Design Files
        const fallback = next[idx - 1] ?? next[0] ?? DESIGN_FILES_TAB;
        activeTab = fallback;
      }
      return { ...state, openTabs: next, activeTab };
    }
    case 'set_active_tab':
      // Any explicit tab change counts as "user/system has decided where to
      // park" — mark autoPickDone so FileTree's first-fetch effect doesn't
      // come along later and yank the active tab away.
      return { ...state, activeTab: action.tab, autoPickDone: true };
    case 'set_tool':
      return { ...state, tool: action.tool };
    case 'add_pin':
      return { ...state, pins: [...state.pins, action.pin] };
    case 'set_drawing_pin':
      return { ...state, drawingPin: action.pin };
    case 'remove_pin':
      return {
        ...state,
        pins: state.pins.filter((p) => p.id !== action.id),
        // Drop the deleted pin from the selection too — otherwise selectedPinIds
        // would carry stale ids that aggregateSelectedPins() can't resolve.
        selectedPinIds: state.selectedPinIds.filter((id) => id !== action.id),
      };
    case 'set_pins':
      return {
        ...state,
        pins: action.pins,
        // Filter out any selected ids that no longer exist after the new fetch
        // (e.g. a pin was deleted on another tab). Keeps the bottom action bar
        // honest about what it's about to send.
        selectedPinIds: state.selectedPinIds.filter((id) => action.pins.some((p) => p.id === id)),
      };
    case 'toggle_pin_selection': {
      const has = state.selectedPinIds.includes(action.id);
      return {
        ...state,
        selectedPinIds: has
          ? state.selectedPinIds.filter((id) => id !== action.id)
          : [...state.selectedPinIds, action.id],
      };
    }
    case 'clear_pin_selection':
      return { ...state, selectedPinIds: [] };
    case 'set_pin_selection':
      return { ...state, selectedPinIds: action.ids };
    case 'set_comments_error':
      return { ...state, commentsError: action.error };
    case 'set_import_open':
      return { ...state, importOpen: action.open };
    case 'set_model_open':
      return { ...state, modelOpen: action.open };
    case 'set_edit':
      return { ...state, edit: { ...state.edit, ...action.edit } };
    case 'set_draw_sub_mode':
      return { ...state, drawSubMode: action.mode };
    case 'begin_draw':
      return { ...state, drawing: action.stroke };
    case 'add_click_annotation':
      return { ...state, drawStrokes: [...state.drawStrokes, action.click] };
    case 'extend_drawing': {
      if (!state.drawing) return state;
      return {
        ...state,
        drawing: {
          ...state.drawing,
          points: [...state.drawing.points, action.point],
        },
      };
    }
    case 'end_drawing': {
      if (!state.drawing) return state;
      const finished: DrawStroke = state.drawing;
      return {
        ...state,
        drawing: null,
        drawStrokes: [...state.drawStrokes, finished],
      };
    }
    case 'set_draw_strokes':
      return { ...state, drawStrokes: action.strokes };
    case 'undo_stroke':
      return { ...state, drawStrokes: state.drawStrokes.slice(0, -1) };
    case 'files_changed':
      return { ...state, filesChangedAt: Date.now() };
    case 'queue_chat_submit':
      return { ...state, pendingChatSubmit: action.request };
    case 'set_composer_seed':
      return { ...state, composerSeed: action.seed };
    case 'clear_composer_seed':
      return { ...state, composerSeed: null };
    case 'set_selected_pin':
      return { ...state, selectedPinId: action.id };
    case 'set_zoom':
      return { ...state, zoom: action.zoom };
    case 'set_previewing_file':
      return { ...state, previewingFile: action.path };
    case 'mark_auto_pick_done':
      return { ...state, autoPickDone: true };
    case 'set_chats': {
      // 设新一组 chats（启动 hydration 或 force refresh）。如果没指定
      // activeChatId，且当前 active 不在新列表里，回退到第一条；空数组
      // 时 active 设 null。
      // 强制按 createdAt asc 排序，跟 add_chat 追加到末尾的语义一致 ——
      // 用户感知：最早的 chat 在最左，新 chat 出现在右侧 + 加号旁。
      const sortedChats = [...action.chats].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let nextActive: string | null;
      if (action.activeChatId !== undefined) {
        nextActive = action.activeChatId;
      } else if (state.activeChatId && sortedChats.some((c) => c.id === state.activeChatId)) {
        nextActive = state.activeChatId;
      } else {
        nextActive = sortedChats[0]?.id ?? null;
      }
      return { ...state, chats: sortedChats, activeChatId: nextActive, chatsError: null };
    }
    case 'set_chats_error':
      return { ...state, chatsError: action.error };
    case 'set_active_chat':
      return { ...state, activeChatId: action.chatId };
    case 'add_chat': {
      // 新 chat 追加到末尾（用户感知：新 chat tab 出现在 + 旁边 / 现有 chat 右
      // 边）。chatLabel 按 idx 算，如果插到最前所有老 chat 标签会 +1，用户困惑。
      const next = [...(state.chats ?? []), action.chat];
      return {
        ...state,
        chats: next,
        activeChatId: action.setActive ? action.chat.id : state.activeChatId,
      };
    }
    case 'rename_chat': {
      if (!state.chats) return state;
      const now = new Date().toISOString();
      return {
        ...state,
        chats: state.chats.map((c) =>
          c.id === action.chatId ? { ...c, title: action.title, updatedAt: now } : c,
        ),
      };
    }
    case 'materialize_chat': {
      // pending chat 完成 POST /chats —— 用 server 返回的 chat 替换占位，清
      // isPending 标记。id 不变（前端生成的 uuid 等于 server 接收的 id）。
      if (!state.chats) return state;
      return {
        ...state,
        chats: state.chats.map((c) =>
          c.id === action.chatId ? { ...action.chat, isPending: false } : c,
        ),
      };
    }
    case 'remove_chat': {
      if (!state.chats) return state;
      const next = state.chats.filter((c) => c.id !== action.chatId);
      let activeChatId = state.activeChatId;
      if (activeChatId === action.chatId) {
        activeChatId = next[0]?.id ?? null;
      }
      return { ...state, chats: next, activeChatId };
    }
    default: {
      // 穷尽性检查
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// ───── Context ─────

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
  // 便捷 actions（包装 dispatch，给子组件少写点）
  actions: {
    openFile: (name: string) => void;
    closeTab: (name: string) => void;
    setActiveTab: (tab: ActiveTab) => void;
    setTool: (tool: Tool) => void;
    /** Optimistic add pin + fire-and-forget POST. Pin must already have id+createdAt. */
    addPin: (pin: CommentPin) => void;
    /** Optimistic remove pin + fire-and-forget DELETE. */
    removePin: (id: string) => void;
    setImportOpen: (open: boolean) => void;
    setModelOpen: (open: boolean) => void;
    setEdit: (partial: Partial<EditState>) => void;
    setDrawStrokes: (strokes: DrawShape[]) => void;
    undoStroke: () => void;
    /** Stage a chat submission for ChatPanel to drain (Draw / Pin → Atelier). */
    queueChatSubmit: (request: PendingChatSubmit | null) => void;
    /**
     * One-shot seed the chat Composer's input with a starter prompt
     * (ExamplesTab "Use this prompt" path). ChatPanel reads on mount and
     * clears via `clearComposerSeed`. NEVER auto-sent — see types.ts notes.
     */
    setComposerSeed: (seed: string | null) => void;
    /** Clear the composer seed after ChatPanel has consumed it. */
    clearComposerSeed: () => void;
    // ── Chats actions（多 chat 支持，Task 2） ──
    /** Switch to an existing chat（不 fetch；caller 按需做 reload）。 */
    setActiveChat: (chatId: string) => void;
    /**
     * Lazy create —— 仅在前端 state 加一个 isPending=true 的 placeholder。
     * 不 POST /chats 直到用户发送第一条消息（届时调 materializeChat）。
     * 返回新 chat id，调用方立即 onSelect 切到它。
     */
    createChat: (title?: string | null) => Promise<string>;
    /**
     * 真实写入 server —— 在用户发送第一条消息前调用。pending chat → POST /chats
     * → dispatch materialize_chat 清掉 isPending。chat 已 real 时 no-op。
     * Throw on POST 失败 —— 让调用方阻断后续 PUT /messages（避免用未存在的 chatId）。
     */
    materializeChat: (chatId: string) => Promise<void>;
    /**
     * Rename a chat（optimistic）：dispatch rename_chat + fire PATCH。
     * 失败时 rollback + toast。
     */
    renameChat: (chatId: string, title: string | null) => Promise<void>;
    /**
     * Delete a chat（optimistic）：dispatch remove_chat + fire DELETE。
     * 失败时 rollback + toast。前端调用方需自行阻拦最后一条 chat 删除。
     */
    deleteChat: (chatId: string) => Promise<void>;
  };
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export interface WorkspaceProviderProps {
  projectId: string;
  readOnly?: boolean;
  children: ReactNode;
}

export function WorkspaceProvider({
  projectId,
  readOnly = false,
  children,
}: WorkspaceProviderProps) {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    makeInitialState(projectId, readOnly),
  );

  // Hydrate chats on project change. If listChats returns empty, lazy-create a
  // first default chat — every project has at least one chat (UI invariant).
  // Skip in readOnly mode — share view ignores chat history (artifact only).
  useEffect(() => {
    if (state.readOnly) return;
    const controller = new AbortController();
    let mounted = true;
    void (async () => {
      try {
        const { chats } = await api<ListChatsResponse>(`/api/projects/${state.projectId}/chats`, {
          signal: controller.signal,
        });
        if (!mounted) return;
        if (chats.length > 0) {
          dispatch({ type: 'set_chats', chats });
          return;
        }
        // 项目下没 chat —— lazy create first default chat (id from client).
        const id = crypto.randomUUID();
        const body: CreateChatRequest = { id, title: null };
        const { chat } = await api<CreateChatResponse>(`/api/projects/${state.projectId}/chats`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
        });
        if (!mounted) return;
        dispatch({ type: 'set_chats', chats: [chat], activeChatId: chat.id });
      } catch (err: unknown) {
        if (!mounted) return;
        if (err instanceof TypeError && /Failed to fetch/i.test(err.message)) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[workspace] failed to load chats', err);
        dispatch({ type: 'set_chats_error', error: message });
      }
    })();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [state.projectId, state.readOnly]);

  // Hydrate pins on project change (skip in readOnly mode — share view ignores comments).
  //
  // P1-7 fix: previously a failed fetch only console.error'd, leaving users with
  // an empty Comments tab and no signal that anything had failed. Now we surface
  // the failure via state.commentsError so CommentsTab can render a degraded
  // "couldn't load comments" notice instead of the generic empty state.
  useEffect(() => {
    if (state.readOnly) return;
    const controller = new AbortController();
    api<ListCommentsResponse>(`/api/projects/${state.projectId}/comments`, {
      signal: controller.signal,
    })
      .then(({ comments }) => {
        if (controller.signal.aborted) return;
        // Server's Comment includes projectId; CommentPin doesn't need it.
        const pins: CommentPin[] = comments.map((c) => ({
          id: c.id,
          n: c.n,
          x: c.x,
          y: c.y,
          text: c.text,
          selector: c.selector ?? null,
          filePath: c.filePath ?? null,
          createdAt: c.createdAt,
        }));
        dispatch({ type: 'set_pins', pins });
        dispatch({ type: 'set_comments_error', error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // Silent on transient network errors that happen during page unload /
        // navigation: browser cancels in-flight fetches → TypeError: Failed to
        // fetch. These aren't real failures, just noise.
        if (err instanceof TypeError && /Failed to fetch/i.test(err.message)) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : String(err);
        // Keep a console.error too — it's still useful for debugging in dev,
        // and other test infrastructure (e.g. e2e console-error scrapers) can
        // filter on the prefix.
        console.error('[workspace] failed to load pins', err);
        dispatch({ type: 'set_comments_error', error: message });
      });
    return () => {
      controller.abort();
    };
  }, [state.projectId, state.readOnly]);

  const value = useMemo<WorkspaceContextValue>(() => {
    const projectId = state.projectId;

    // Optimistic write: dispatch then fire-and-forget POST. keepalive lets the
    // request survive a refresh that lands between the click and the response.
    //
    // On failure we surface a toast so the user knows their pin/edit didn't
    // hit the server (was: console.error swallow → no UI feedback). We do
    // NOT revert the optimistic state — the pin is still valid in-session and
    // will retry on the next addPin (the user can also re-save manually).
    const persistAddPin = (pin: CommentPin) => {
      void api(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        body: {
          id: pin.id,
          n: pin.n,
          x: pin.x,
          y: pin.y,
          text: pin.text,
          ...(pin.selector ? { selector: pin.selector } : {}),
          ...(pin.filePath ? { filePath: pin.filePath } : {}),
        } as unknown as BodyInit,
        keepalive: true,
      }).catch((err: unknown) => {
        console.error('[workspace] failed to persist pin', err);
        showToast({
          message: "Couldn't save comment. It will be lost on reload.",
          variant: 'error',
        });
      });
    };
    const persistRemovePin = (id: string) => {
      void api(`/api/projects/${projectId}/comments/${id}`, {
        method: 'DELETE',
        keepalive: true,
      }).catch((err: unknown) => {
        console.error('[workspace] failed to delete pin', err);
        showToast({
          message: "Couldn't delete comment. It may reappear on reload.",
          variant: 'error',
        });
      });
    };

    const setActiveChat = (chatId: string) => dispatch({ type: 'set_active_chat', chatId });

    /**
     * Lazy create —— 仅 dispatch 一个前端 placeholder（isPending=true）。**不**
     * POST /chats，避免 db 累积空 chat。真正创建在用户发送第一条消息时由
     * `materializeChat` 完成。
     */
    const createChat = async (title: string | null = null): Promise<string> => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const placeholder: LocalChat = {
        id,
        projectId,
        title,
        createdAt: now,
        updatedAt: now,
        isPending: true,
      };
      dispatch({ type: 'add_chat', chat: placeholder, setActive: true });
      return id;
    };

    /**
     * 把 pending chat 真正写到 server —— 在用户发送第一条消息前调用。
     * 同步成功后 dispatch materialize_chat 清 isPending 标记。
     * 已是 real chat（无 isPending）则 no-op。
     * Throw on failure：让调用方阻断后续 PUT /messages（用未存在的 chatId 必败）。
     */
    const materializeChat = async (chatId: string): Promise<void> => {
      const target = state.chats?.find((c) => c.id === chatId);
      if (!target) {
        throw new Error(`materializeChat: chat ${chatId} not found in state`);
      }
      if (!target.isPending) return; // 已 materialize 过
      const body: CreateChatRequest = { id: target.id, title: target.title };
      const { chat } = await api<CreateChatResponse>(`/api/projects/${projectId}/chats`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
      dispatch({ type: 'materialize_chat', chatId: chat.id, chat });
    };

    /** Optimistic rename + PATCH + rollback on failure. */
    const renameChat = async (chatId: string, title: string | null): Promise<void> => {
      const prev = state.chats?.find((c) => c.id === chatId);
      if (!prev) return;
      const prevTitle = prev.title;
      dispatch({ type: 'rename_chat', chatId, title });
      try {
        const body: PatchChatRequest = { title };
        await api<PatchChatResponse>(`/api/projects/${projectId}/chats/${chatId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        });
      } catch (err: unknown) {
        console.error('[workspace] renameChat failed', err);
        dispatch({ type: 'rename_chat', chatId, title: prevTitle });
        showToast({
          message: "Couldn't rename chat. Please try again.",
          variant: 'error',
        });
        throw err;
      }
    };

    /** Optimistic delete + DELETE + rollback on failure. */
    const deleteChatAction = async (chatId: string): Promise<void> => {
      const prev = state.chats ?? [];
      const target = prev.find((c) => c.id === chatId);
      if (!target) return;
      const prevActive = state.activeChatId;
      dispatch({ type: 'remove_chat', chatId });
      try {
        await api<void>(`/api/projects/${projectId}/chats/${chatId}`, {
          method: 'DELETE',
        });
      } catch (err: unknown) {
        console.error('[workspace] deleteChat failed', err);
        // rollback —— restore chat at its previous slot + restore previous active
        dispatch({ type: 'set_chats', chats: prev, activeChatId: prevActive });
        showToast({
          message: "Couldn't delete chat. Please try again.",
          variant: 'error',
        });
        throw err;
      }
    };

    const actions = {
      openFile: (name: string) => dispatch({ type: 'open_file', name }),
      closeTab: (name: string) => dispatch({ type: 'close_tab', name }),
      setActiveTab: (tab: ActiveTab) => dispatch({ type: 'set_active_tab', tab }),
      setTool: (tool: Tool) => dispatch({ type: 'set_tool', tool }),
      addPin: (pin: CommentPin) => {
        dispatch({ type: 'add_pin', pin });
        if (!state.readOnly) persistAddPin(pin);
      },
      removePin: (id: string) => {
        dispatch({ type: 'remove_pin', id });
        if (!state.readOnly) persistRemovePin(id);
      },
      setImportOpen: (open: boolean) => dispatch({ type: 'set_import_open', open }),
      setModelOpen: (open: boolean) => dispatch({ type: 'set_model_open', open }),
      setEdit: (partial: Partial<EditState>) => dispatch({ type: 'set_edit', edit: partial }),
      setDrawStrokes: (strokes: DrawShape[]) => dispatch({ type: 'set_draw_strokes', strokes }),
      undoStroke: () => dispatch({ type: 'undo_stroke' }),
      queueChatSubmit: (request: PendingChatSubmit | null) =>
        dispatch({ type: 'queue_chat_submit', request }),
      setComposerSeed: (seed: string | null) => dispatch({ type: 'set_composer_seed', seed }),
      clearComposerSeed: () => dispatch({ type: 'clear_composer_seed' }),
      setActiveChat,
      createChat,
      materializeChat,
      renameChat,
      deleteChat: deleteChatAction,
    };
    return { state, dispatch, actions };
  }, [state]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be called within a <WorkspaceProvider>');
  }
  return ctx;
}
