// Workspace state shape —— 给 chat / preview agent 的契约。
//
// 关键约定：
//   - activeTab 既可以是 "Design Files"（特殊值）也可以是文件名（如 "LinkBank.html"）
//   - tool: null 表示无激活工具；其余 4 值与 toolbar 按钮一一对应
//   - drawSubMode 是 Draw 工具内部的子模式
//   - 所有 chat/preview 相关 state 都在这里集中
//
// 复刻精度：fields 跟 prototype 一字对应；类型化收紧。

// (Legacy ChatBubble + Atelier/Todos/ToolCall types removed —— after the
// agent SDK switch, chat history is owned by useAgentChat / useChat and
// persisted via /api/projects/:id/messages, not workspace state. Tools
// timeline UI now reads useChat messages directly via activity-builder.ts.)

// Re-export Chat 给 UI 直接 import（避免 ../../packages/contracts 长路径污染）。
import type { Chat } from '@open-design/contracts';
export type { Chat };

// 前端扩展：lazy-created 但还没 POST 到 server 的 chat 标 isPending=true。
// 点 + 加号时只创建 LocalChat（前端 state），用户发送第一条消息时才
// materialize（POST /chats）。POST 后 isPending 清掉，id / createdAt 不变。
export type LocalChat = Chat & { isPending?: boolean };

// ───── Pin / 评论（per drawingPin / pins flow） ─────

export interface CommentPin {
  /** Client-generated UUID (crypto.randomUUID). Stable across optimistic save → POST round-trip. */
  id: string;
  x: number;
  y: number;
  n: number;
  text: string;
  /** Optional CSS selector — populated when pin originates from ELEMENT_SELECTED. */
  selector?: string | null;
  /** Path of the artifact file the pin was dropped on; lets CommentsTab jump back. */
  filePath?: string | null;
  /** ISO timestamp; assigned at draft creation. */
  createdAt: string;
}

// ───── Draw 工具笔迹（per ProtoMain drawStrokes / drawing） ─────

export type DrawSubMode = 'draw' | 'click' | 'voice';

export interface DrawStroke {
  type: 'draw';
  points: [number, number][];
}

export interface ClickAnnotation {
  type: 'click';
  x: number;
  y: number;
}

export type DrawShape = DrawStroke | ClickAnnotation;

// ───── Pending chat submission queue ─────
//
// PreviewPanel can't call `chat.sendMessage` directly (the Chat instance lives
// in ChatPanel). To submit a Draw screenshot or Comment pin to the agent we
// stage the request here; ChatPanel watches state.pendingChatSubmit and drains
// it via useChat once a key is set.
//
// `attachments` uses a minimal shape (data URLs) instead of Vercel AI SDK's
// FileUIPart so workspace state doesn't depend on the `ai` package; ChatPanel
// converts to FileUIPart at the boundary.

export interface PendingAttachment {
  /** IANA media type, e.g. "image/png". */
  mediaType: string;
  /** Either an http(s) URL or a data: URL with base64 payload. */
  url: string;
  filename?: string;
}

export interface PendingChatSubmit {
  text: string;
  attachments?: PendingAttachment[];
}

// ───── Composer seed (one-shot prefill) ─────
//
// ExamplesTab "Use this prompt" → POST /api/projects → sessionStorage seed →
// Workspace mount drain → setComposerSeed(seed). ChatPanel reads it on the
// next render, fills its Composer `input` state, and clears the seed via
// clearComposerSeed (one-shot semantics).
//
// Distinct from `pendingChatSubmit`:
//   - composerSeed = "user picked a starter prompt; let them review & send"
//     → never auto-sent (user must manually press Cmd+Enter / click Send).
//   - pendingChatSubmit = "Draw screenshot / Pin 'Send to Atelier'"
//     → auto-sent the moment a BYOK key is available; BYOK gate kicks in if
//     missing.
//
// Two channels intentionally separate so the BYOK race that drops example
// prompts (cancel KeyModal → message lost) can never affect the examples flow.

// ───── Edit float state ─────
//
// Tweaks: 不再有 host-side fallback state —— 完全 artifact-driven。
// 用户改 EDITMODE-aware artifact 自带的 Tweaks UI → iframe 内 React state
// 重渲染 + postMessage `__edit_mode_set_keys` → host 把 edits merge 进源文件
// EDITMODE 块。详见 PreviewPanel.tsx persistEditModeKeys() 和 system-prompt
// "## Tweaks" 段。

export interface EditState {
  bg: string;
  font: string;
  base: number;
  headingSize: number;
}

// ───── 工具枚举（必须跟 toolbar 按钮 4 个对齐） ─────

export type Tool = 'tweaks' | 'comment' | 'edit' | 'draw' | null;

// 文件 tab 的特殊常量
export const DESIGN_FILES_TAB = 'Design Files' as const;
// "Live preview" 伪 tab：React 项目用它做主入口（auto-pick 指向这里）。
// JSX/TSX 文件如果当 activeTab 用，路由会去 FileSourceView 显示源码 ——
// 用户期望的"运行起来的 React 应用"必须有个独立 tab 名才能跟"看 App.jsx 源码"区分开。
export const PREVIEW_TAB = 'Preview' as const;

export type ActiveTab = typeof DESIGN_FILES_TAB | typeof PREVIEW_TAB | string;

// ───── 顶层 state ─────
//
// 已删除的字段（agent SDK 切换 + 后续 cleanup 后不再使用）：
//   messages   → useChat 内部持有 + GET/PUT /api/projects/:id/messages
//   composer / chips → ChatPanel 局部 useState
//   model      → lib/model-pref.ts localStorage（getModelId/setModelId）
//   chatTab    → ChatPanel 局部 useState
//   streaming  → useAgentChat status === 'streaming'

export interface WorkspaceState {
  projectId: string;
  // 文件 tab 状态
  openTabs: string[];
  activeTab: ActiveTab;
  // Preview 工具栏
  tool: Tool;
  // Comment 工具
  pins: CommentPin[];
  drawingPin: CommentPin | null;
  /**
   * Pin ids the user has multi-selected via the checkbox in CommentsTab.
   * The bottom action bar (Add note + Send to Claude) only appears when
   * length > 0. Sending aggregates the chosen pins into a single chat
   * message and clears this back to []. Front-end-only state — server
   * doesn't track selection (each session selects independently).
   */
  selectedPinIds: string[];
  /**
   * Last error from hydrating /api/projects/:id/comments. null = no error
   * (either fetch succeeded or hasn't been attempted yet). Surface as a
   * subtle inline notice in CommentsTab — "comments failed to load" — so
   * users don't think their pins were lost. Cleared when a successful fetch
   * lands; we don't currently expose a manual retry but reload restores.
   */
  commentsError: string | null;
  // Header / popover 显隐（lifted up so global click-dismiss can close them）
  importOpen: boolean;
  modelOpen: boolean;
  // Edit 工具（Tweaks 是 artifact-driven，没有 host state）
  edit: EditState;
  // Draw 工具
  drawStrokes: DrawShape[];
  drawing: DrawStroke | null;
  drawSubMode: DrawSubMode;
  // 只读模式（/share/:token 用）
  readOnly: boolean;
  // 文件变更时间戳（毫秒，Date.now()），用于触发 FileTree / PreviewPanel re-fetch
  filesChangedAt: number;
  // PreviewPanel → ChatPanel 的单 slot 队列：Draw send / Pin "Send to Atelier"。
  // ChatPanel 监听到非 null 就 drain 给 chat.sendMessage 并 clear 回 null。
  pendingChatSubmit: PendingChatSubmit | null;
  /**
   * One-shot seed for the chat Composer's input. Set by Workspace mount drain
   * after ExamplesTab → "Use this prompt" stashes a prompt in sessionStorage.
   * ChatPanel reads on render, calls setInput(seed), then clears via
   * clear_composer_seed. NEVER auto-sent — user reviews and submits manually.
   * See PendingChatSubmit notes for the contrast with pendingChatSubmit.
   */
  composerSeed: string | null;
  /** Pin id selected from CommentsTab; PreviewPanel scrolls it into view + flashes. */
  selectedPinId: string | null;
  /**
   * Preview iframe zoom — number is a multiplier (1.0 = 100%), 'fit' lets the
   * iframe stretch naturally to fill the container (no transform). Driven by
   * Toolbar Zoom dropdown + trackpad pinch (wheel + ctrlKey on Mac).
   */
  zoom: number | 'fit';
  /**
   * File path currently shown in FileTree's right-side preview pane.
   * Distinct from activeTab — clicking a row sets this (peek), clicking
   * "Open" in the pane promotes it to activeTab + openTabs (commit).
   */
  previewingFile: string | null;
  /**
   * True once FileTree has auto-picked the entry for this project (kicked
   * activeTab to PREVIEW), OR the user has explicitly clicked any tab.
   * Used by FileTree's auto-pick effect as a guard so a slow first-fetch
   * doesn't yank the user to PREVIEW after they've already clicked
   * Design Files (P0-3 race fix, 2026-05-03).
   *
   * Lives in WorkspaceProvider state so it resets per-project (key on
   * Workspace.tsx makes each project its own provider instance).
   */
  autoPickDone: boolean;
  // ── Chats（多 chat 支持，Task 2） ──
  /**
   * Project 下所有 chats（按 updated_at 降序），可能含 isPending=true 的本地
   * 占位。null = 还没 fetch 过；
   * [] = fetched 但项目下没 chat（即将 lazy create 第一条 default chat）。
   */
  chats: LocalChat[] | null;
  /**
   * 当前激活的 chat id；ChatTabBar 高亮 + useAgentChat 用它当 chatId
   * 持久化 + filter messages。
   */
  activeChatId: string | null;
  /** Last error from listChats fetch；UI 可显示 inline 提示。 */
  chatsError: string | null;
}

/** Discrete zoom presets surfaced in the Toolbar dropdown. */
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.5] as const;
export const ZOOM_FIT = 'fit' as const;
/** Pinch zoom hard caps so trackpad gestures can't shrink to 0 or zoom past 4×. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

// ───── Action union（给 reducer 用） ─────

export type WorkspaceAction =
  | { type: 'open_file'; name: string }
  | { type: 'close_tab'; name: string }
  | { type: 'set_active_tab'; tab: ActiveTab }
  | { type: 'set_tool'; tool: Tool }
  | { type: 'add_pin'; pin: CommentPin }
  | { type: 'set_drawing_pin'; pin: CommentPin | null }
  | { type: 'remove_pin'; id: string }
  | { type: 'set_pins'; pins: CommentPin[] }
  | { type: 'set_comments_error'; error: string | null }
  | { type: 'set_import_open'; open: boolean }
  | { type: 'set_model_open'; open: boolean }
  | { type: 'set_edit'; edit: Partial<EditState> }
  | { type: 'set_draw_sub_mode'; mode: DrawSubMode }
  | { type: 'begin_draw'; stroke: DrawStroke }
  | { type: 'add_click_annotation'; click: ClickAnnotation }
  | { type: 'extend_drawing'; point: [number, number] }
  | { type: 'end_drawing' }
  | { type: 'set_draw_strokes'; strokes: DrawShape[] }
  | { type: 'undo_stroke' }
  | { type: 'files_changed' }
  | { type: 'queue_chat_submit'; request: PendingChatSubmit | null }
  | { type: 'set_composer_seed'; seed: string | null }
  | { type: 'clear_composer_seed' }
  | { type: 'set_selected_pin'; id: string | null }
  | { type: 'toggle_pin_selection'; id: string }
  | { type: 'clear_pin_selection' }
  | { type: 'set_pin_selection'; ids: string[] }
  | { type: 'set_zoom'; zoom: number | 'fit' }
  | { type: 'set_previewing_file'; path: string | null }
  | { type: 'mark_auto_pick_done' }
  // ── Chats actions（多 chat 支持，Task 2） ──
  | { type: 'set_chats'; chats: Chat[]; activeChatId?: string | null }
  | { type: 'set_chats_error'; error: string | null }
  | { type: 'set_active_chat'; chatId: string }
  | { type: 'add_chat'; chat: LocalChat; setActive?: boolean }
  // pending chat 的 POST /chats 完成后调用 —— 用 server 返回的 chat 对象替换
  // 同 id 的 pending entry，并清掉 isPending 标记。
  | { type: 'materialize_chat'; chatId: string; chat: Chat }
  | { type: 'rename_chat'; chatId: string; title: string | null }
  | { type: 'remove_chat'; chatId: string };
