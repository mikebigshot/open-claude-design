// Workspace 顶部 Header
//   logo cell（点击回 /）
//   项目名 cell
//   TabBar
//   Present 按钮（→ /p/:id/present）
//   Share popover （Public link 复制 + Standalone HTML 导出 + 7 项 coming soon）
//   用户头像
//
// 设置入口（API key + 语言）只放在主页（Home）的左下角；Workspace 不重复
// 暴露 settings 图标，避免一个功能两个入口造成困惑。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

import { useT } from '@/i18n';
import { useWorkspace } from '@/state/workspace';

import { ChevronIcon, LogoIcon } from './icons';
import { SharePopover } from './SharePopover';
import { TabBar } from './TabBar';

interface HeaderProps {
  /** 用户/创建者展示用的项目名 */
  projectName: string;
}

const Bar = styled.div`
  display: flex;
  align-items: stretch;
  height: 44px;
  border-bottom: 1px solid ${(p) => p.theme.colors.line100};
  background: ${(p) => p.theme.colors.bg100};
  flex-shrink: 0;
`;

// 用户需求 (d)：第 1 行也按 420px / 1fr 切分，跟下方 SecondaryBar 一致 ——
// 左半 (LogoCell + 项目名) 占 ChatPanel 宽度；右半 (文件 tab + Present/Share/头像)
// 占 PreviewArea 宽度。文件 tab 紧挨预览区上方。
const HeaderLeft = styled.div`
  width: 420px;
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  border-right: 1px solid ${(p) => p.theme.colors.line100};
`;

const HeaderRight = styled.div`
  flex: 1;
  display: flex;
  align-items: stretch;
  min-width: 0;
`;

const LogoCell = styled.div`
  width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid ${(p) => p.theme.colors.line100};
  cursor: pointer;
  transition: background 0.14s;

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
  }
`;

const ProjectCell = styled.div`
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 8px;
  flex: 1;
  min-width: 0;
  /* HeaderLeft 已有 border-right，这里不再画 */
`;

const ProjectName = styled.span`
  font-size: 12.5px;
  font-weight: 500;
  color: ${(p) => p.theme.colors.fg100};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Right = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  position: relative;
`;

const GhostBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: transparent;
  border: none;
  font-family: inherit;
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg300};
  cursor: pointer;
  border-radius: 6px;
  transition:
    background 0.14s,
    color 0.14s;

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg100};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const ShareBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  background: ${(p) => p.theme.colors.brandBase};
  color: #fff;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.14s;

  &:hover {
    background: ${(p) => p.theme.colors.brandHover};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const ShareWrap = styled.div`
  position: relative;
`;

// Present▾ dropdown menu — same shape as the Toolbar's Present menu
// (Full screen / Without chrome). Two visible Present buttons exist:
// this one in the top Header (always visible) and the Eye icon in the
// preview Toolbar (only visible when previewing a file). Both end up at
// the same UX so users can hit either.
const PresentWrap = styled.div`
  position: relative;
`;

const PresentMenu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 8px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 4px;
  z-index: 60;
  font-size: 12.5px;
`;

const PresentMenuItem = styled.button`
  display: block;
  width: 100%;
  padding: 6px 10px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: ${(p) => p.theme.colors.fg100};
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
  }
`;

const PresentMenuSub = styled.div`
  font-size: 10.5px;
  color: ${(p) => p.theme.colors.fg400};
  margin-top: 2px;
`;

function findPreviewIframe(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>('iframe[title="Preview"]');
}

const Avatar = styled.div`
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: ${(p) => p.theme.colors.brandSoft};
  color: ${(p) => p.theme.colors.brandPress};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
`;

export function Header({ projectName }: HeaderProps) {
  const t = useT();
  const navigate = useNavigate();
  const { state } = useWorkspace();
  const [shareOpen, setShareOpen] = useState(false);
  const shareWrapRef = useRef<HTMLDivElement | null>(null);

  // close popover on outside-click; the wrapper has stopPropagation on its
  // own click so clicks inside don't dismiss it
  useEffect(() => {
    if (!shareOpen) return;
    const handleDocClick = (e: MouseEvent) => {
      if (!shareWrapRef.current) return;
      if (!shareWrapRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [shareOpen]);

  // Present▾ dropdown — Full screen (browser fullscreen API on the iframe)
  // OR Without chrome (navigate to /present which renders only the iframe).
  const [presentOpen, setPresentOpen] = useState(false);
  const presentWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!presentOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!presentWrapRef.current) return;
      if (!presentWrapRef.current.contains(e.target as Node)) setPresentOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [presentOpen]);

  const handleFullscreen = useCallback(() => {
    setPresentOpen(false);
    const iframe = findPreviewIframe();
    if (!iframe) {
      // No preview iframe yet (e.g. user is on Design Files tab) — fall back
      // to the Without-chrome route so the action still does something useful.
      navigate(`/p/${state.projectId}/present`);
      return;
    }
    if (iframe.requestFullscreen) {
      void iframe.requestFullscreen().catch((err) => {
        console.warn('[present] fullscreen denied', err);
      });
    }
  }, [navigate, state.projectId]);

  const handleWithoutChrome = useCallback(() => {
    setPresentOpen(false);
    navigate(`/p/${state.projectId}/present`);
  }, [navigate, state.projectId]);

  return (
    <Bar>
      <HeaderLeft>
        <LogoCell title={t('header.home')} role="button" onClick={() => navigate('/')}>
          <LogoIcon size={20} />
        </LogoCell>
        <ProjectCell>
          <ProjectName title={projectName}>{projectName}</ProjectName>
        </ProjectCell>
      </HeaderLeft>
      <HeaderRight>
        <TabBar />
        {!state.readOnly && (
          <Right>
            <PresentWrap ref={presentWrapRef}>
              <GhostBtn
                type="button"
                title={t('header.present')}
                aria-haspopup="menu"
                aria-expanded={presentOpen}
                onClick={() => setPresentOpen((v) => !v)}
              >
                {t('header.present')} <ChevronIcon />
              </GhostBtn>
              {presentOpen && (
                <PresentMenu role="menu">
                  <PresentMenuItem type="button" role="menuitem" onClick={handleFullscreen}>
                    {t('header.presentFullScreen')}
                    <PresentMenuSub>{t('header.presentFullScreenHint')}</PresentMenuSub>
                  </PresentMenuItem>
                  <PresentMenuItem type="button" role="menuitem" onClick={handleWithoutChrome}>
                    {t('header.presentWithoutChrome')}
                    <PresentMenuSub>{t('header.presentWithoutChromeHint')}</PresentMenuSub>
                  </PresentMenuItem>
                </PresentMenu>
              )}
            </PresentWrap>
            <ShareWrap ref={shareWrapRef}>
              <ShareBtn type="button" onClick={() => setShareOpen((v) => !v)}>
                {t('header.share')}
              </ShareBtn>
              {shareOpen && (
                <SharePopover
                  projectId={state.projectId}
                  projectName={projectName}
                  onClose={() => setShareOpen(false)}
                />
              )}
            </ShareWrap>
            <Avatar>im</Avatar>
          </Right>
        )}
      </HeaderRight>
    </Bar>
  );
}
