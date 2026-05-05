// Preview 区上方的 Toolbar
//   FILE TREE 标签 / PREVIEW · {filename}
//   4 工具按钮（Tweaks / Comment / Edit / Draw）— 切 active 态走 useWorkspace
//   Reload / Open in tab / Present 实功能：
//     - Reload   : iframe.contentWindow.location.reload()，绕开 React diff
//     - Open ↗   : srcdoc → blob: URL → window.open
//     - Present  : navigate('/p/:id/present')

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

import { useT } from '@/i18n';
import { useWorkspace } from '@/state/workspace';
import { DESIGN_FILES_TAB, PREVIEW_TAB, ZOOM_PRESETS, ZOOM_FIT } from '@/state/types';
import type { Tool } from '@/state/types';

import {
  CommentIcon,
  EyeIcon,
  GlobeIcon,
  PenIcon,
  ReloadIcon,
  SettingsIcon,
  SparkleIcon,
} from './icons';

// Task 8: Toolbar 现在嵌在 SecondaryBar 右侧（Workspace.tsx），而不是 PreviewArea
// 顶部。height / border-bottom 由父级 SecondaryBar 提供，这里改为 100% + 透明背景
// 让边框由父容器统一管理。
const Bar = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: transparent;
  gap: 4px;
  min-width: 0;
`;

const Spacer = styled.div`
  flex: 1;
`;

const ToolBtn = styled.button<{ $active: boolean }>`
  padding: 4px 10px;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  background: ${(p) => (p.$active ? p.theme.colors.brandTint : 'transparent')};
  color: ${(p) => (p.$active ? p.theme.colors.brandPress : p.theme.colors.fg300)};
  border: 1px solid ${(p) => (p.$active ? p.theme.colors.brandSoft : 'transparent')};
  cursor: pointer;
  font-family: inherit;
  transition:
    background 0.14s,
    color 0.14s,
    border-color 0.14s;

  &:hover {
    background: ${(p) => (p.$active ? p.theme.colors.brandTint : p.theme.colors.bg200)};
    color: ${(p) => p.theme.colors.fg100};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const IconBtn = styled.button`
  padding: 4px 8px;
  font-size: 11.5px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  color: ${(p) => p.theme.colors.fg300};
  font-family: inherit;
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

const Divider = styled.div`
  width: 1px;
  height: 18px;
  background: ${(p) => p.theme.colors.line200};
  margin: 0 6px;
`;

// ZoomTrigger — small button that opens the zoom menu. Shows the active zoom
// label ("75%" / "Fit") in mono so it lines up with the file path Hint.
const ZoomTrigger = styled.button`
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 10.5px;
  color: ${(p) => p.theme.colors.fg400};
  letter-spacing: 0.4px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg100};
  }
`;

// PresentMenu — small dropdown anchored at the EyeIcon button. Two options:
// "Full screen" (browser fullscreen API on the iframe) and "Without chrome"
// (navigate to /p/:id/present which renders only the iframe). Layout matches
// the model picker / share popover idiom used elsewhere.
const MenuWrap = styled.span`
  position: relative;
  display: inline-flex;
`;

const Menu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 160px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 8px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 4px;
  z-index: 60;
  font-size: 12px;
`;

const MenuItem = styled.button`
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
  font-size: 12px;

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
  }
`;

const MenuItemSub = styled.div`
  font-size: 10.5px;
  color: ${(p) => p.theme.colors.fg400};
  margin-top: 2px;
`;

interface ToolDef {
  key: NonNullable<Tool>;
  labelKey: 'toolbar.tool.tweaks' | 'toolbar.tool.comment' | 'toolbar.tool.edit' | 'toolbar.tool.draw';
  icon: React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { key: 'tweaks', labelKey: 'toolbar.tool.tweaks', icon: <SettingsIcon /> },
  { key: 'comment', labelKey: 'toolbar.tool.comment', icon: <CommentIcon /> },
  { key: 'edit', labelKey: 'toolbar.tool.edit', icon: <PenIcon /> },
  { key: 'draw', labelKey: 'toolbar.tool.draw', icon: <SparkleIcon /> },
];

function findPreviewIframe(): HTMLIFrameElement | null {
  return document.querySelector<HTMLIFrameElement>('iframe[title="Preview"]');
}

function formatZoom(zoom: number | 'fit', fitLabel: string): string {
  return zoom === 'fit' ? fitLabel : `${Math.round(zoom * 100)}%`;
}

export function Toolbar() {
  const t = useT();
  const { state, dispatch, actions } = useWorkspace();
  const navigate = useNavigate();
  const isFiles = state.activeTab === DESIGN_FILES_TAB;

  const handleReload = useCallback(() => {
    // BUG-FIX 2026-05-03: previously called iframe.contentWindow.location.reload()
    // which only re-parsed the *current* srcdoc — the host-side files state was
    // stale, so the user kept seeing the same old bundle even after the agent
    // wrote new files. Now we dispatch `files_changed`, which:
    //   1. Triggers PreviewPanel's fetch effect (keyed on filesChangedAt) →
    //      pulls fresh content from the worker's R2/D1.
    //   2. The new files produce a new srcdoc string → React updates the iframe
    //      srcDoc attribute → browser re-parses → fresh bundle, clean state.
    //   3. The iframe is also keyed on filesChangedAt downstream, so it
    //      remounts (resetting cached-root + Tweaks state) on every reload.
    dispatch({ type: 'files_changed' });
  }, [dispatch]);

  const handleOpenInNewTab = useCallback(() => {
    const iframe = findPreviewIframe();
    const srcdoc = iframe?.srcdoc;
    if (!srcdoc) return;
    const blob = new Blob([srcdoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    // Don't revoke immediately — browser auto-collects after the new tab closes.
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  // ── Present▾ dropdown ──
  const [presentOpen, setPresentOpen] = useState(false);
  const presentRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!presentOpen) return;
    const onClick = (e: MouseEvent) => {
      if (presentRef.current && !presentRef.current.contains(e.target as Node)) {
        setPresentOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [presentOpen]);

  const handleFullscreen = useCallback(() => {
    setPresentOpen(false);
    const iframe = findPreviewIframe();
    if (!iframe) return;
    // Fullscreen API: prefer the iframe directly so the artifact takes the
    // entire screen (browser chrome included). ESC exits per spec.
    if (iframe.requestFullscreen) {
      void iframe.requestFullscreen().catch((err) => {
        console.warn('[present] fullscreen denied', err);
      });
    }
  }, []);

  const handleWithoutChrome = useCallback(() => {
    setPresentOpen(false);
    if (!state.projectId) return;
    navigate(`/p/${state.projectId}/present`);
  }, [navigate, state.projectId]);

  // ── Zoom dropdown ──
  const [zoomOpen, setZoomOpen] = useState(false);
  const zoomRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!zoomOpen) return;
    const onClick = (e: MouseEvent) => {
      if (zoomRef.current && !zoomRef.current.contains(e.target as Node)) {
        setZoomOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [zoomOpen]);

  const setZoom = useCallback(
    (next: number | 'fit') => {
      dispatch({ type: 'set_zoom', zoom: next });
      setZoomOpen(false);
    },
    [dispatch],
  );

  // 点工具按钮时如果在 Design Files tab，自动切到 Preview tab —— 工具针对预览
  // iframe 生效，留在 Design Files tab 看不到效果。
  const handleToolClick = useCallback(
    (key: 'tweaks' | 'comment' | 'edit' | 'draw') => {
      if (isFiles) {
        actions.setActiveTab(PREVIEW_TAB);
      }
      actions.setTool(state.tool === key ? null : key);
    },
    [isFiles, actions, state.tool],
  );

  return (
    <Bar>
      <Spacer />
      {!state.readOnly && (
        <>
          {TOOLS.map((tool) => {
            const label = t(tool.labelKey);
            return (
              <ToolBtn
                key={tool.key}
                type="button"
                data-testid={`toolbar-${tool.key}`}
                data-active={state.tool === tool.key ? 'true' : 'false'}
                aria-pressed={state.tool === tool.key}
                aria-label={`${label} tool`}
                $active={state.tool === tool.key}
                onClick={() => handleToolClick(tool.key)}
              >
                {tool.icon}
                {label}
              </ToolBtn>
            );
          })}
          <Divider />
          <IconBtn
            type="button"
            title={t('toolbar.reload')}
            aria-label={t('toolbar.reload')}
            onClick={handleReload}
          >
            <ReloadIcon />
          </IconBtn>
          <IconBtn
            type="button"
            title={t('toolbar.openInNewTab')}
            aria-label={t('toolbar.openInNewTab')}
            onClick={handleOpenInNewTab}
          >
            <GlobeIcon />
          </IconBtn>
          <MenuWrap ref={presentRef}>
            <IconBtn
              type="button"
              title={t('toolbar.present')}
              aria-label={t('toolbar.present')}
              aria-haspopup="menu"
              aria-expanded={presentOpen}
              onClick={() => setPresentOpen((v) => !v)}
            >
              <EyeIcon />
            </IconBtn>
            {presentOpen && (
              <Menu role="menu">
                <MenuItem type="button" role="menuitem" onClick={handleFullscreen}>
                  {t('toolbar.presentFullScreen')}
                  <MenuItemSub>{t('toolbar.presentFullScreenHint')}</MenuItemSub>
                </MenuItem>
                <MenuItem type="button" role="menuitem" onClick={handleWithoutChrome}>
                  {t('toolbar.presentWithoutChrome')}
                  <MenuItemSub>{t('toolbar.presentWithoutChromeHint')}</MenuItemSub>
                </MenuItem>
              </Menu>
            )}
          </MenuWrap>
          <Divider />
          <MenuWrap ref={zoomRef}>
            <ZoomTrigger
              type="button"
              aria-haspopup="menu"
              aria-expanded={zoomOpen}
              onClick={() => setZoomOpen((v) => !v)}
              title={t('toolbar.zoom')}
            >
              {formatZoom(state.zoom, t('toolbar.fit'))}
            </ZoomTrigger>
            {zoomOpen && (
              <Menu role="menu">
                {ZOOM_PRESETS.map((preset) => (
                  <MenuItem
                    key={preset}
                    type="button"
                    role="menuitem"
                    onClick={() => setZoom(preset)}
                  >
                    {`${Math.round(preset * 100)}%`}
                    {state.zoom === preset && <MenuItemSub>{t('toolbar.zoomActive')}</MenuItemSub>}
                  </MenuItem>
                ))}
                <MenuItem type="button" role="menuitem" onClick={() => setZoom(ZOOM_FIT)}>
                  {t('toolbar.fit')}
                  {state.zoom === ZOOM_FIT && <MenuItemSub>{t('toolbar.zoomActive')}</MenuItemSub>}
                </MenuItem>
              </Menu>
            )}
          </MenuWrap>
        </>
      )}
    </Bar>
  );
}
