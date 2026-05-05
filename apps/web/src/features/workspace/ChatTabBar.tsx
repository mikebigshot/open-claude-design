// 第二行左侧 ChatTabBar —— 多 chat 支持。
//
// Layout：
//   [Chat A] [Chat B] ... [+] | [Comments (n)] [Activity]
//
// chat tab 项动态来自 workspace state.chats。点击 + 新建一个空 chat 并切到它
// （workspace.actions.createChat —— optimistic UI）。双击 chat tab inline
// rename；右键弹一个 Delete confirm（最少保 1 条 chat）。
//
// Comments / Activity 是 fixed 虚拟 tab —— 视觉同 chat tab，但点击会让
// ChatPanel 走 commentsTab / activityTab 视图（不影响 chats 列表本身）。
//
// 视觉跟 features/workspace/TabBar.tsx 风格一致（active = bg50 + fg100,
// inactive = transparent + fg400），但 ChatPanel 是 panel 内左下，没 ActiveBar 顶饰。

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

import { useT } from '@/i18n';
import { useWorkspace } from '@/state/workspace';

// Selection model exposed externally. Discriminated union 让 caller / 测试
// 不用 stringly compare。`comments` / `activity` 是固定的 reserved view ids；
// `chat` 用来指代任意一条 chat（chatId 在 payload 里）。
export type ChatViewSelection =
  | { kind: 'chat'; chatId: string }
  | { kind: 'comments' }
  | { kind: 'activity' };

interface ChatTabBarProps {
  /** 当前选中的视图。 */
  selection: ChatViewSelection;
  /** 点击/切换时调；caller 接住 selection 触发 ChatPanel 切视图。 */
  onSelect: (sel: ChatViewSelection) => void;
  /** Comments tab 上的小数字徽标（pins.length）。 */
  commentsCount: number;
}

const Bar = styled.div`
  display: flex;
  align-items: stretch;
  height: 40px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
`;

// 左侧 scroll 区: chat tabs + 加号 一起水平 scroll。chat 多了不会撑开 Bar，
// 也不会把 Comments / Activity 推出去。webkit 隐藏滚动条但保留滚动能力。
const ScrollArea = styled.div`
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

// 右侧固定区: Comments / Activity 永远可见 + Divider 跟左侧分开。
const FixedArea = styled.div`
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  border-left: 1px solid ${(p) => p.theme.colors.line100};
`;

const Tab = styled.div<{ $active: boolean }>`
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: ${(p) => (p.$active ? p.theme.colors.bg50 : 'transparent')};
  font-size: 12.5px;
  color: ${(p) => (p.$active ? p.theme.colors.fg100 : p.theme.colors.fg400)};
  font-weight: ${(p) => (p.$active ? 500 : 400)};
  cursor: pointer;
  position: relative;
  white-space: nowrap;
  user-select: none;
  border-right: 1px solid ${(p) => p.theme.colors.line100};
  transition:
    background 0.14s,
    color 0.14s;

  &:hover {
    color: ${(p) => p.theme.colors.fg100};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: -2px;
  }
`;

const ActiveBar = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: ${(p) => p.theme.colors.bg50};
`;

const RenameInput = styled.input`
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 4px;
  padding: 1px 4px;
  width: 120px;
  outline: none;

  &:focus {
    border-color: ${(p) => p.theme.colors.brandBase};
  }
`;

const NewBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  background: transparent;
  border: none;
  border-right: 1px solid ${(p) => p.theme.colors.line100};
  cursor: pointer;
  color: ${(p) => p.theme.colors.fg400};
  font-family: inherit;
  font-size: 16px;
  line-height: 1;
  transition:
    background 0.14s,
    color 0.14s;

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg100};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: -2px;
  }
`;


// Inline confirm popover for delete (anchored under the right-clicked tab).
const ConfirmPop = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 50;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 8px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 8px 10px;
  font-size: 12px;
  white-space: nowrap;
  display: flex;
  gap: 8px;
  align-items: center;
`;

const DangerBtn = styled.button`
  background: ${(p) => p.theme.colors.danger};
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
`;

const GhostBtn = styled.button`
  background: transparent;
  color: ${(p) => p.theme.colors.fg300};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11.5px;
  font-family: inherit;
  cursor: pointer;
`;

export function ChatTabBar({ selection, onSelect, commentsCount }: ChatTabBarProps) {
  const t = useT();
  const { state, actions } = useWorkspace();
  const chats = state.chats ?? [];

  const chatLabel = (title: string | null, idx: number): string =>
    title && title.trim().length > 0 ? title : t('workspace.chats.chatLabel', { n: idx + 1 });

  // Inline rename state (double-click chat tab).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Right-click delete confirm popover state.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // ScrollArea ref —— 创建新 chat / 激活 chat 时让 active tab 滚到视口里。
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const activeChatId = selection.kind === 'chat' ? selection.chatId : null;
  useEffect(() => {
    if (!activeChatId || !scrollAreaRef.current) return;
    const tabEl = scrollAreaRef.current.querySelector<HTMLElement>(
      `[data-testid="chat-tab-${activeChatId}"]`,
    );
    // JSDOM 不实现 scrollIntoView —— 仅在浏览器环境调用。
    if (tabEl && typeof tabEl.scrollIntoView === 'function') {
      tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeChatId, chats.length]);

  // Wheel → 水平 scroll：触摸板原本就能横向滑（浏览器原生 deltaX）；这里
  // 把 deltaY 主导的滚轮事件转成 scrollLeft 增量，让外接鼠标用户也能滚。
  // 同时支持 pointer drag → 按住任意位置拖动横向滚（含 tab 上）；区分 click vs
  // drag 用 5px 阈值，drag 后 suppress 一次 click 防止误切 chat。
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handleWheel, { passive: false });

    // ── pointer drag-to-scroll ──
    let pointerDown = false;
    let startX = 0;
    let startScrollLeft = 0;
    let dragStarted = false;
    let activePointerId: number | null = null;

    const DRAG_THRESHOLD_PX = 5;

    const onPointerDown = (e: PointerEvent) => {
      // 仅左键 / 触摸 / 笔。中键 / 右键不参与。
      if (e.button !== 0) return;
      pointerDown = true;
      dragStarted = false;
      startX = e.clientX;
      startScrollLeft = el.scrollLeft;
      activePointerId = e.pointerId;
    };

    const resetDragState = () => {
      pointerDown = false;
      activePointerId = null;
      if (dragStarted) {
        el.style.cursor = '';
        el.style.userSelect = '';
      }
      dragStarted = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointerDown || e.pointerId !== activePointerId) return;
      // 防御：浏览器在某些情形会丢失 pointerup（alt-tab、devtools focus 切换、
      // 系统级 focus 偷走）→ pointerDown 状态停在 true。用 e.buttons 位掩码
      // 校验当前真的还按着左键（buttons & 1 === 1）；不按了立即 reset，避免
      // 用户感知"hover 也能拖动"。
      if ((e.buttons & 1) === 0) {
        resetDragState();
        return;
      }
      const dx = e.clientX - startX;
      if (!dragStarted && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        dragStarted = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // 某些环境（如 contextmenu 已发）会拒绝 capture，忽略
        }
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
      }
      if (dragStarted) {
        el.scrollLeft = startScrollLeft - dx;
      }
    };

    // 鼠标离开 ScrollArea 时也重置 —— 防止 pointerup 被 ScrollArea 外的容器
    // 吃掉（容器禁掉了 pointer events 等）。
    const onPointerLeave = () => {
      if (!pointerDown) return;
      resetDragState();
    };

    const endDrag = (e: PointerEvent) => {
      if (!pointerDown || e.pointerId !== activePointerId) return;
      pointerDown = false;
      activePointerId = null;
      if (dragStarted) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        el.style.cursor = '';
        el.style.userSelect = '';
        // drag 结束后浏览器会派发一次 click 到松手位置 → 拦掉防误触切 chat
        const suppressClick = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener('click', suppressClick, { capture: true, once: true });
      }
      dragStarted = false;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('pointerleave', onPointerLeave);

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.removeEventListener('pointerleave', onPointerLeave);
    };
  }, []);

  // Auto-focus rename input on enter.
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Outside-click closes confirm popover.
  useEffect(() => {
    if (!confirmId) return;
    const handler = () => setConfirmId(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [confirmId]);

  const submitRename = async (chatId: string) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    const orig = chats.find((c) => c.id === chatId)?.title ?? null;
    const next = title.length === 0 ? null : title;
    if (next === orig) return; // unchanged
    try {
      await actions.renameChat(chatId, next);
    } catch {
      /* toast already shown by action */
    }
  };

  const handleNewChat = async () => {
    // Lazy create —— 如果已有 pending（前端创建但用户没发任何消息）的 chat，
    // 直接切到它，不再创建新的。避免 chat tab 越点越多但全是空的。
    const existingPending = chats.find((c) => c.isPending);
    if (existingPending) {
      onSelect({ kind: 'chat', chatId: existingPending.id });
      return;
    }
    try {
      const id = await actions.createChat(null);
      // 显式 onSelect —— Workspace useEffect 跟随 activeChatId 同步 selection
      // 在某些 batch 时机下迟一帧，这里直接切。
      onSelect({ kind: 'chat', chatId: id });
    } catch {
      /* createChat 现在不 POST，几乎不会失败 */
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    setConfirmId(null);
    if (chats.length <= 1) return; // safety: never let UI delete the last
    try {
      await actions.deleteChat(chatId);
    } catch {
      /* toast shown */
    }
  };

  const isChatActive = (chatId: string) => selection.kind === 'chat' && selection.chatId === chatId;

  return (
    <Bar role="tablist" aria-label={t('workspace.chats.aria')}>
      <ScrollArea ref={scrollAreaRef} data-testid="chat-tabbar-scroll">
      {chats.map((c, idx) => {
        const active = isChatActive(c.id);
        const renaming = renamingId === c.id;
        const showConfirm = confirmId === c.id;
        return (
          <Tab
            key={c.id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            $active={active}
            onClick={() => {
              if (renaming) return;
              onSelect({ kind: 'chat', chatId: c.id });
            }}
            onDoubleClick={() => {
              setRenameDraft(c.title ?? '');
              setRenamingId(c.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (chats.length <= 1) return; // no delete for last chat
              setConfirmId(c.id);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect({ kind: 'chat', chatId: c.id });
              }
            }}
            data-testid={`chat-tab-${c.id}`}
            data-active={active ? 'true' : 'false'}
          >
            {renaming ? (
              <RenameInput
                ref={renameInputRef}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => submitRename(c.id)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submitRename(c.id);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingId(null);
                  }
                }}
                aria-label={`Rename ${chatLabel(c.title, idx)}`}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span>{chatLabel(c.title, idx)}</span>
            )}
            {active && !renaming && <ActiveBar />}
            {showConfirm && (
              <ConfirmPop
                role="dialog"
                aria-label={t('workspace.chats.deleteConfirmAria')}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span>{t('workspace.chats.deleteConfirmAria')}</span>
                <DangerBtn
                  type="button"
                  onClick={() => void handleDeleteChat(c.id)}
                  data-testid={`chat-delete-confirm-${c.id}`}
                >
                  {t('common.delete')}
                </DangerBtn>
                <GhostBtn type="button" onClick={() => setConfirmId(null)}>
                  {t('common.cancel')}
                </GhostBtn>
              </ConfirmPop>
            )}
          </Tab>
        );
      })}
      </ScrollArea>

      <FixedArea>
      {/* 加号固定在 ScrollArea 末尾、Comments/Activity 之前 —— chat 多到溢出时
          不会被滚出视口（用户报告：第 4 个 chat 后看不到 + 按钮）。*/}
      <NewBtn
        type="button"
        title={t('workspace.chats.newChat')}
        aria-label={t('workspace.chats.newChat')}
        onClick={handleNewChat}
        data-testid="chat-tab-new"
      >
        +
      </NewBtn>
      <Tab
        role="tab"
        tabIndex={0}
        aria-selected={selection.kind === 'comments'}
        $active={selection.kind === 'comments'}
        onClick={() => onSelect({ kind: 'comments' })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect({ kind: 'comments' });
          }
        }}
        data-testid="chat-tab-comments"
        data-active={selection.kind === 'comments' ? 'true' : 'false'}
      >
        <span>
          {commentsCount > 0
            ? t('workspace.chats.commentsTabWithCount', { n: commentsCount })
            : t('workspace.chats.commentsTab')}
        </span>
        {selection.kind === 'comments' && <ActiveBar />}
      </Tab>

      <Tab
        role="tab"
        tabIndex={0}
        aria-selected={selection.kind === 'activity'}
        $active={selection.kind === 'activity'}
        onClick={() => onSelect({ kind: 'activity' })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect({ kind: 'activity' });
          }
        }}
        data-testid="chat-tab-activity"
        data-active={selection.kind === 'activity' ? 'true' : 'false'}
      >
        <span>{t('workspace.chats.activityTab')}</span>
        {selection.kind === 'activity' && <ActiveBar />}
      </Tab>
      </FixedArea>
    </Bar>
  );
}
