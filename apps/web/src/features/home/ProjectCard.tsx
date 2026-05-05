// 单个项目卡片（hover lift / NEW 徽章动画）

import { useEffect, useRef, useState } from 'react';
import styled, { keyframes, css } from 'styled-components';

import type { Project } from '@open-design/contracts';
import { useT } from '@/i18n';

import { ProjectThumb } from './ProjectThumb';

type TFn = ReturnType<typeof useT>;

interface ProjectCardProps {
  project: Project;
  /** 是否刚创建（触发 600ms 弹入动画 + NEW 徽章） */
  justCreated?: boolean;
  /** 点击卡片回调（一般 → /p/{id}） */
  onOpen: (project: Project) => void;
  /** Sub-text，例如 "Your design · Today" — 不传时按 type / updatedAt 推断 */
  sub?: string;
  /** 高亮色卡（设计系统类项目） */
  highlight?: boolean;
  /** 卡面背景色 */
  color?: string;
  /** Optional: hovering reveals ⋯ menu with Rename / Delete entries. */
  onRename?: (project: Project, nextName: string) => void;
  onDelete?: (project: Project) => void;
}

const cardPop = keyframes`
  0% { transform: scale(.92); opacity: 0; }
  60% { transform: scale(1.02); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

const Wrap = styled.div<{ $justCreated: boolean }>`
  cursor: pointer;
  ${(p) =>
    p.$justCreated &&
    css`
      animation: ${cardPop} 600ms ease-out;
    `}
`;

const Thumb = styled.div<{ $hover: boolean; $highlight: boolean; $bg: string }>`
  height: 110px;
  border-radius: 8px;
  background: ${(p) => p.$bg};
  border: ${(p) =>
    p.$highlight
      ? `1.5px solid ${p.theme.colors.brandBase}`
      : `1px solid ${p.theme.colors.line200}`};
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: ${(p) => (p.$hover ? p.theme.shadows.md : p.theme.shadows.sm)};
  transform: ${(p) => (p.$hover ? 'translateY(-1px)' : 'none')};
  transition:
    transform 0.14s,
    box-shadow 0.14s;
  position: relative;
`;

const NewBadge = styled.div`
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  background: ${(p) => p.theme.colors.success};
  color: #fff;
  font-size: 9.5px;
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 0.2px;
`;

const Name = styled.div`
  margin-top: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: ${(p) => p.theme.colors.fg100};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Sub = styled.div<{ $highlight: boolean }>`
  font-size: 10.5px;
  color: ${(p) => (p.$highlight ? p.theme.colors.brandPress : p.theme.colors.fg400)};
  margin-top: 2px;
`;

const MoreBtn = styled.button`
  position: absolute;
  top: 6px;
  left: 6px;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: ${(p) => p.theme.colors.bg100};
  border: 1px solid ${(p) => p.theme.colors.line200};
  color: ${(p) => p.theme.colors.fg300};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  font-family: inherit;
  z-index: 2;
  transition:
    background 0.14s,
    color 0.14s;

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg100};
  }
`;

const MenuPanel = styled.div`
  position: absolute;
  top: 32px;
  left: 6px;
  min-width: 120px;
  background: ${(p) => p.theme.colors.bg100};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 8px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 4px;
  z-index: 5;
  font-size: 12px;
`;

const MenuItem = styled.button<{ $danger?: boolean }>`
  width: 100%;
  display: block;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  color: ${(p) => (p.$danger ? p.theme.colors.danger : p.theme.colors.fg100)};

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
  }
`;

const NameInput = styled.input`
  width: 100%;
  padding: 4px 6px;
  margin-top: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: ${(p) => p.theme.colors.fg100};
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.brandBase};
  border-radius: 4px;
  font-family: inherit;
  outline: none;
`;

function defaultSub(project: Project, t: TFn): string {
  const date = new Date(project.updatedAt);
  if (Number.isNaN(date.getTime())) return t('projectCard.subYourDesign');
  const now = Date.now();
  const diff = now - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  let when = t('common.earlier');
  if (diff < day) when = t('common.today');
  else if (diff < 2 * day) when = t('common.yesterday');
  else if (diff < 7 * day) when = t('common.daysAgo', { n: Math.floor(diff / day) });
  else when = date.toLocaleDateString();
  const kind =
    project.type === 'prototype'
      ? t('projectCard.subYourDesign')
      : t('projectCard.subDesignSystem');
  return `${kind} · ${when}`;
}

export function ProjectCard({
  project,
  justCreated = false,
  onOpen,
  sub,
  highlight = false,
  color,
  onRename,
  onDelete,
}: ProjectCardProps) {
  const t = useT();
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const showMenu = !!(onRename || onDelete);
  const showMoreBtn = showMenu && (hover || menuOpen) && !renaming;

  const commitRename = () => {
    const next = draftName.trim();
    if (next && next !== project.name && onRename) {
      onRename(project, next);
    }
    setRenaming(false);
  };

  const cancelRename = () => {
    setDraftName(project.name);
    setRenaming(false);
  };

  return (
    <Wrap
      ref={wrapRef}
      $justCreated={justCreated}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={renaming ? undefined : () => onOpen(project)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (renaming) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(project);
        }
      }}
      aria-label={t('projectCard.openAria', { name: project.name })}
      data-testid={`project-item-${project.id}`}
    >
      <Thumb $hover={hover} $highlight={highlight} $bg={color ?? '#FAF9F5'}>
        {/* 项目缩略图 —— ProjectThumb IO 触发后 fetch files + buildSrcdoc + 缩放
            iframe 显示。还没 fetch / 项目空 / 失败 → fallback 到原 SVG 占位。*/}
        <ProjectThumb
          projectId={project.id}
          updatedAt={project.updatedAt}
          fallback={
            <svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden>
              <path
                d="M3 12 L3 38 a2 2 0 002 2 h54 a2 2 0 002-2 L61 16 a2 2 0 00-2-2 H30 L26 10 H5 a2 2 0 00-2 2 z"
                fill="#fff"
                stroke="#DDD8C8"
                strokeWidth="1"
              />
              <rect x="8" y="20" width="20" height="2" rx="1" fill="#E9E6DC" />
              <rect x="8" y="25" width="32" height="2" rx="1" fill="#E9E6DC" />
            </svg>
          }
        />
        {justCreated && <NewBadge>{t('projectCard.newBadge')}</NewBadge>}
        {showMoreBtn && (
          <MoreBtn
            type="button"
            aria-label={t('projectCard.menuAria')}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            ⋯
          </MoreBtn>
        )}
        {menuOpen && (
          <MenuPanel onClick={(e) => e.stopPropagation()}>
            {onRename && (
              <MenuItem
                type="button"
                onClick={() => {
                  setDraftName(project.name);
                  setRenaming(true);
                  setMenuOpen(false);
                }}
              >
                {t('projectCard.menuRename')}
              </MenuItem>
            )}
            {onDelete && (
              <MenuItem
                type="button"
                $danger
                onClick={() => {
                  setMenuOpen(false);
                  if (window.confirm(t('projectCard.deleteConfirm', { name: project.name }))) {
                    onDelete(project);
                  }
                }}
              >
                {t('projectCard.menuDelete')}
              </MenuItem>
            )}
          </MenuPanel>
        )}
      </Thumb>
      {renaming ? (
        <NameInput
          autoFocus
          value={draftName}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') cancelRename();
          }}
          aria-label={t('projectCard.renameAria')}
        />
      ) : (
        <Name>{project.name}</Name>
      )}
      <Sub $highlight={highlight}>{sub ?? defaultSub(project, t)}</Sub>
    </Wrap>
  );
}
