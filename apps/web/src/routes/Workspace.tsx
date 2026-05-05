// Workspace 路由
// 顶层 layout（Task 8 重构后）：
//   <WorkspaceProvider projectId={id}>
//     <Header />                ← 第 1 行: Logo + 项目名 + 文件 TabBar + Right
//     <SecondaryHeader>         ← 第 2 行: ChatTabBar (左) + Toolbar (右)
//     <Body>
//       <ChatPanelSlot selection={...} />
//       <PreviewArea>
//         <PreviewBody>
//           <PreviewPanelSlot />   ← 永久 mount(底层),iframe 持久化避免重 build
//           <Overlay>              ← FileTree / FileSourceView 叠在上面
//         </PreviewBody>
//       </PreviewArea>
//     </Body>
//   </WorkspaceProvider>
//
// 第 2 行设计：左侧 ChatTabBar（chat tab1 | chat tab2 | + | Comments | Activity）
// 占满到 ChatPanel 宽度（420px），右侧 Toolbar 占满 PreviewArea 宽度。两者用一个
// 全宽容器拼起来，靠内部 CSS 边界对齐。Toolbar 不再单独是 PreviewArea 子元素。
//
// P0-2 fix (2026-05-03): PreviewPanelSlot 从 conditional render 改成永久
// mount + CSS display 切显隐。这样切 Source / FileTree 标签时 iframe DOM
// 节点和 contentWindow 都保留 —— Babel 不重 compile,artifact 内部 React
// state 不丢。FileTree / FileSourceView 用 absolute 定位的 Overlay 叠在
// PreviewPanelSlot 上面,用 conditional render(它们不需要持久化)。

import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import type { Project } from '@open-design/contracts';

import { ApiError, api } from '@/lib/api';
import {
  ChatPanelSlot,
  FileSourceView,
  FileTree,
  Header,
  PreviewPanelSlot,
  Toolbar,
} from '@/features/workspace';
import { ChatTabBar, type ChatViewSelection } from '@/features/workspace/ChatTabBar';
import { isHtmlPath } from '@/features/workspace/file-utils';
import { useT } from '@/i18n';
import { DESIGN_FILES_TAB, PREVIEW_TAB, useWorkspace, WorkspaceProvider } from '@/state/workspace';

interface WorkspaceProps {
  /** /share/:token 路由会渲染只读版本 */
  readOnly?: boolean;
  /** /share/:token 路由直接传项目 id；普通 /p/:id 用 url params */
  projectIdOverride?: string;
}

const Shell = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: ${(p) => p.theme.colors.bg100};
  color: ${(p) => p.theme.colors.fg100};
  font-family: ${(p) => p.theme.fonts.sans};
  position: relative;
  overflow: hidden;
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
`;

// SecondaryBar — 第 2 行容器：左侧 ChatTabBar 占 420px（== ChatPanel 宽度），
// 右侧 Toolbar 占 1fr（== PreviewArea 宽度）。两者用一条 vertical separator 隔开
// 跟 ChatPanel / PreviewArea 的边界对齐。
const SecondaryBar = styled.div`
  display: flex;
  align-items: stretch;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid ${(p) => p.theme.colors.line100};
  background: ${(p) => p.theme.colors.bg100};
`;

const SecondaryLeft = styled.div`
  width: 420px;
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  border-right: 1px solid ${(p) => p.theme.colors.line100};
  background: ${(p) => p.theme.colors.bg100};
  min-width: 0;
`;

const SecondaryRight = styled.div`
  flex: 1;
  display: flex;
  align-items: stretch;
  min-width: 0;
`;

const PreviewArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background: ${(p) => p.theme.colors.bg200};
  min-height: 0;
  position: relative;
`;

const PreviewBody = styled.div`
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
`;

// PersistentLayer — wraps PreviewPanelSlot so it stays in the React tree even
// when the user is on the Design Files / Source view. Display toggling keeps
// the iframe + bridge alive across tab switches (F-4 fix).
const PersistentLayer = styled.div<{ $hidden: boolean }>`
  position: absolute;
  inset: 0;
  display: ${(p) => (p.$hidden ? 'none' : 'flex')};
`;

// FileOverlayLayer — full-bleed cover for FileTree / FileSourceView. Sits on
// top of PersistentLayer when the user wants to see files instead of preview.
const FileOverlayLayer = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  background: ${(p) => p.theme.colors.bg100};
`;

const ErrorOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme.colors.bg100};
  color: ${(p) => p.theme.colors.fg300};
  font-family: ${(p) => p.theme.fonts.sans};
  padding: 24px;
  text-align: center;
`;

// NotFoundFrame — full-screen 404 state for /p/:unknown-id.
// P1-6 fix (2026-05-03): explicit not-found UI with "Back to Home" link
// instead of falling back to "(offline)" project name + rendering full shell.
const NotFoundFrame = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme.colors.bg100};
  color: ${(p) => p.theme.colors.fg100};
  font-family: ${(p) => p.theme.fonts.sans};
`;

const NotFoundCard = styled.div`
  max-width: 520px;
  text-align: center;
  padding: 32px;
`;

const NotFoundTitle = styled.h1`
  margin: 0 0 12px;
  font-size: 22px;
  font-weight: 600;
  color: ${(p) => p.theme.colors.fg100};
`;

const NotFoundSub = styled.p`
  margin: 0 0 24px;
  font-size: 14px;
  line-height: 1.55;
  color: ${(p) => p.theme.colors.fg300};
`;

const NotFoundCode = styled.code`
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 12px;
  background: ${(p) => p.theme.colors.bg200};
  padding: 2px 6px;
  border-radius: 4px;
  color: ${(p) => p.theme.colors.fg200};
`;

const NotFoundLink = styled(Link)`
  display: inline-block;
  padding: 8px 18px;
  background: ${(p) => p.theme.colors.brandBase};
  color: #fff;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.14s;

  &:hover {
    background: ${(p) => p.theme.colors.brandHover};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const DropHint = styled.div`
  position: absolute;
  bottom: 0;
  right: 0;
  padding: 6px 14px;
  font-size: 10.5px;
  font-family: ${(p) => p.theme.fonts.mono};
  color: ${(p) => p.theme.colors.fg400};
  letter-spacing: 0.4px;
  pointer-events: none;
`;

// ───── 内层组件 —— 在 provider 内才能 useWorkspace ─────

function WorkspaceShell({ projectName }: { projectName: string }) {
  const { state, actions } = useWorkspace();
  const t = useT();

  // SecondaryHeader 选择状态：
  //   - mount 时 chats 还没 hydrate → 暂存一个 placeholder 让 ChatPanel 显示
  //     comments view（不让 chat thread crash）。
  //   - hydration 完毕后第一次 transition：把 placeholder 改成 active chat。
  //   - 用户主动点 Comments / Activity 后保持，直到他们再点 chat tab。
  //   - 用户点 chat tab → handleSelect 同步 workspace.actions.setActiveChat。
  //   - workspace.activeChatId 外部改变（不通过 handleSelect，例如新建 chat
  //     的 add_chat reducer 把 active 切到新 chat）→ 当前若是 chat view
  //     follow workspace；若是 Comments/Activity 则保留用户的选择。
  //
  // initialAutoLand ref 是 hydration 一次性使能的 sentinel —— 防止用户切到
  // Comments 后被 effect 再 race-back 到 chat。
  const [secondarySelection, setSecondarySelection] = useState<ChatViewSelection>(() =>
    state.activeChatId
      ? { kind: 'chat', chatId: state.activeChatId }
      : { kind: 'comments' as const },
  );
  const initialAutoLandedRef = useRef<boolean>(state.activeChatId !== null);

  useEffect(() => {
    if (!state.activeChatId) return;
    // 第一次 hydration 完成 → 切到 active chat（仅一次）。
    if (!initialAutoLandedRef.current) {
      initialAutoLandedRef.current = true;
      setSecondarySelection({ kind: 'chat', chatId: state.activeChatId });
      return;
    }
    // 后续 workspace.activeChatId 改了：仅当当前已是 chat view 才跟随。
    // Comments / Activity 是用户主动选的，hydration 不应该把他们 yank 走。
    if (secondarySelection.kind === 'chat' && secondarySelection.chatId !== state.activeChatId) {
      setSecondarySelection({ kind: 'chat', chatId: state.activeChatId });
    }
  }, [state.activeChatId, secondarySelection]);

  const handleSelect = useCallback(
    (sel: ChatViewSelection) => {
      setSecondarySelection(sel);
      if (sel.kind === 'chat') {
        // 同步 workspace state.activeChatId 让 useAgentChat / 持久化也跟着切。
        actions.setActiveChat(sel.chatId);
      }
    },
    [actions],
  );

  const commentsCount = state.pins.length;
  // memoize selection 防止 ChatPanel 因 stable identity 问题重渲染。
  const stableSelection = useMemo(() => secondarySelection, [secondarySelection]);

  // ExamplesTab → "Use this prompt" stashes a seed prompt in sessionStorage
  // before navigating here. Drain it once on mount: setComposerSeed pre-fills
  // the chat Composer input so the user can review and submit manually.
  // We deliberately DO NOT queueChatSubmit (which would auto-send) — that
  // path collides with the BYOK gate (KeyModal → cancel → message lost). The
  // composerSeed channel is the safe "draft prefill" pattern.
  // Keyed by project id so a stale seed for project A doesn't fire when the
  // user opens project B in the same tab.
  useEffect(() => {
    // New key (composerSeed semantics) + legacy key (auto-send semantics) both
    // drained — old tabs with the legacy key still get their prompt prefilled
    // instead of dropped. Drop the legacy key in a future release.
    const newKey = `open-design:seed-composer:${state.projectId}`;
    const legacyKey = `open-design:seed-prompt:${state.projectId}`;
    let seed: string | null = null;
    try {
      seed = sessionStorage.getItem(newKey) ?? sessionStorage.getItem(legacyKey);
      if (sessionStorage.getItem(newKey) !== null) sessionStorage.removeItem(newKey);
      if (sessionStorage.getItem(legacyKey) !== null) sessionStorage.removeItem(legacyKey);
    } catch {
      /* private mode etc — no seed */
    }
    if (seed && seed.trim().length > 0) {
      actions.setComposerSeed(seed);
    }
    // `actions` is stable per workspace context value, so depending on
    // projectId alone is sufficient — we want to drain exactly once per
    // project switch. (The exhaustive-deps rule isn't enabled in this repo,
    // but keeping the deps minimal documents intent.)
  }, [state.projectId, actions]);

  // 全局点击关闭 popovers（按 prototype 的行为）
  const onShellClick = useCallback(() => {
    if (state.importOpen) actions.setImportOpen(false);
    if (state.modelOpen) actions.setModelOpen(false);
  }, [actions, state.importOpen, state.modelOpen]);

  // 三种顶层视图 ——
  //   isPreview: 直接看 iframe 渲染产物(默认 + 高频)
  //   isFiles  : 看 FileTree(split layout)
  //   isSource : 看某个具体文件源码(从 Tab 进入或文件树 Open)
  // PreviewPanelSlot 永久 mount 在底层(PersistentLayer);只在用户切到 Files/
  // Source 时叠一层 overlay 把它盖住 —— 这样 iframe DOM 节点 + contentWindow
  // 跨 tab 切换不重建,Babel 不重新 compile,artifact 内部 React state 不丢。
  const isFiles = state.activeTab === DESIGN_FILES_TAB;
  const isPreview = state.activeTab === PREVIEW_TAB || isHtmlPath(state.activeTab);
  const isSource = !isFiles && !isPreview;

  return (
    <Shell onClick={onShellClick} data-testid="workspace-root">
      <Header projectName={projectName} />
      {/* 第 2 行：左侧 ChatTabBar (chat tab1 | chat tab2 | + | Comments | Activity)
          + 右侧 Toolbar (Tweaks / Comment / Edit / Draw / Reload / Globe / Eye / Zoom)。
          read-only / share view 不显示（无多 chat、无工具）。 */}
      {!state.readOnly && (
        <SecondaryBar role="navigation" aria-label={t('workspace.chatToolsAria')}>
          <SecondaryLeft>
            <ChatTabBar
              selection={stableSelection}
              onSelect={handleSelect}
              commentsCount={commentsCount}
            />
          </SecondaryLeft>
          <SecondaryRight>
            <Toolbar />
          </SecondaryRight>
        </SecondaryBar>
      )}
      <Body>
        <ChatPanelSlot selection={stableSelection} />
        <PreviewArea>
          <PreviewBody>
            {/* PreviewPanelSlot 永久 mount;display 切显隐 —— iframe 持久。
                只有 isPreview 时它处在前台;其余时 overlay 层盖住它。 */}
            <PersistentLayer $hidden={!isPreview}>
              <PreviewPanelSlot />
            </PersistentLayer>
            {isFiles && (
              <FileOverlayLayer>
                <FileTree />
              </FileOverlayLayer>
            )}
            {isSource && (
              <FileOverlayLayer>
                <FileSourceView path={state.activeTab} />
              </FileOverlayLayer>
            )}
          </PreviewBody>
        </PreviewArea>
      </Body>
      {!state.readOnly && <DropHint>{t('workspace.dropFilesHint')}</DropHint>}
    </Shell>
  );
}

export function Workspace({ readOnly = false, projectIdOverride }: WorkspaceProps = {}) {
  const params = useParams<{ id?: string }>();
  const projectId = projectIdOverride ?? params.id ?? '';
  const t = useT();

  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // P1-6 (2026-05-03): when GET /api/projects/:id 返 404, render dedicated
  // not-found UI instead of the "(offline)" fallback. notFound is a separate
  // signal so non-404 errors (e.g. 5xx network) can still fall through to the
  // legacy shell-with-offline-name path (better than blocking on transient
  // failures).
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoadError(null);
    setProject(null);
    setNotFound(false);
    void api<Project>(`/api/projects/${encodeURIComponent(projectId)}`)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        setLoadError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) {
    return (
      <Shell>
        <ErrorOverlay>{t('workspace.errorMissingId')}</ErrorOverlay>
      </Shell>
    );
  }

  if (notFound) {
    return (
      <NotFoundFrame data-testid="workspace-not-found">
        <NotFoundCard>
          <NotFoundTitle>{t('workspace.errorNotFoundTitle')}</NotFoundTitle>
          <NotFoundSub>
            {t('workspace.errorNotFoundLine1', { id: projectId })}{' '}
            {t('workspace.errorNotFoundLine2')}
          </NotFoundSub>
          <NotFoundLink to="/">{t('workspace.errorBackHome')}</NotFoundLink>
        </NotFoundCard>
      </NotFoundFrame>
    );
  }

  // 非 404 错误（worker 5xx / 网络）：之前只 fallback 到 "(offline)" 标签，
  // 但 workspace shell 仍渲染 → 用户以为正常进了项目（chat panel 还能输入但
  // 发不出去）。这是 UX bug。改成显式错误 UI + 重试入口。
  if (loadError) {
    return (
      <NotFoundFrame data-testid="workspace-load-error" role="alert">
        <NotFoundCard>
          <NotFoundTitle>{t('workspace.errorLoadTitle')}</NotFoundTitle>
          <NotFoundSub>
            {t('workspace.errorLoadLine1', { id: projectId })} {t('workspace.errorLoadLine2')}
          </NotFoundSub>
          <NotFoundCode style={{ marginBottom: 24 }}>{loadError}</NotFoundCode>
          <NotFoundLink to="/">{t('workspace.errorBackHome')}</NotFoundLink>
        </NotFoundCard>
      </NotFoundFrame>
    );
  }

  // 即使后端还没准备好也允许进入（用 fallback 名字），方便 chat / preview agent 单独跑
  const projectName = project?.name ?? (loadError ? `${projectId} (offline)` : projectId);

  // key={projectId} 在切换项目时强制重新 mount WorkspaceProvider —— useReducer
  // 的 initial state 函数才会重新跑,state.projectId 才会跟当前 URL 一致。
  // 否则 goto p1 → goto p2 时 state 仍持有 p1,FileTree 永远 fetch p1 files。
  return (
    <WorkspaceProvider key={projectId} projectId={projectId} readOnly={readOnly}>
      <WorkspaceShell projectName={projectName} />
    </WorkspaceProvider>
  );
}

export default Workspace;
