// 设计系统下拉
// "Open Design Default" + "None" 可选；其他 3 项（claude-style / atelier /
// material-3）灰显（Coming soon），等设计系统数据落地后再启用。
// "None" = 用户明确不要任何 design system 约束，agent 自由发挥（不引外部
// CDN 依赖）；语义见 system-prompt/block-2.ts 的 NONE_DESIGN_SYSTEM 段落。

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

import { useT } from '@/i18n';

import { ChevronIcon, CheckIcon } from './icons';

type DictKey = Parameters<ReturnType<typeof useT>>[0];

interface DesignSystemOption {
  id: string;
  labelKey: DictKey;
  enabled: boolean;
}

const SYSTEMS: DesignSystemOption[] = [
  { id: 'open-design-default', labelKey: 'home.designSystem.openDesignDefault', enabled: true },
  { id: 'claude-style', labelKey: 'home.designSystem.claudeStyle', enabled: false },
  { id: 'atelier', labelKey: 'home.designSystem.atelierSystem', enabled: false },
  { id: 'material-3', labelKey: 'home.designSystem.material3', enabled: false },
  { id: 'none', labelKey: 'home.designSystem.none', enabled: true },
];

interface DesignSystemPickerProps {
  value: string;
  onChange: (id: string) => void;
}

const Wrapper = styled.div`
  position: relative;
  margin-bottom: 14px;
`;

const Trigger = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 6px;
  background: ${(p) => p.theme.colors.bg50};
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: ${(p) => p.theme.colors.fg100};

  &:hover {
    background: ${(p) => p.theme.colors.bg100};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const Tag = styled.span`
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: ${(p) => p.theme.colors.brandBase};
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const TextCol = styled.div`
  flex: 1;
  min-width: 0;
`;

const Title = styled.div`
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Sub = styled.div`
  font-size: 10px;
  color: ${(p) => p.theme.colors.fg400};
`;

const Menu = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 8px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 4px;
  z-index: 30;
  font-size: 12px;
`;

const MenuItem = styled.div<{ $disabled: boolean; $selected: boolean }>`
  padding: 7px 10px;
  border-radius: 4px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: ${(p) => (p.$disabled ? p.theme.colors.fg500 : p.theme.colors.fg100)};
  font-weight: ${(p) => (p.$selected ? 500 : 400)};

  &:hover {
    background: ${(p) => (p.$disabled ? 'transparent' : p.theme.colors.bg200)};
  }
`;

export function DesignSystemPicker({ value, onChange }: DesignSystemPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 全局点击关闭
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = SYSTEMS.find((s) => s.id === value) ?? SYSTEMS[0];
  if (!current) return null;

  // Trigger sub-label hint; "None" is the explicit no-system pick (free
  // style), default carries the Open Design tokens.
  const subLabel =
    current.id === 'none' ? t('home.designSystem.freeStyle') : t('home.designSystem.default');

  return (
    <Wrapper ref={wrapRef}>
      <Trigger
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Tag>风</Tag>
        <TextCol>
          <Title>{t(current.labelKey)}</Title>
          <Sub>{subLabel}</Sub>
        </TextCol>
        <ChevronIcon />
      </Trigger>
      {open && (
        <Menu role="listbox">
          {SYSTEMS.map((s) => (
            <MenuItem
              key={s.id}
              role="option"
              aria-selected={s.id === value}
              aria-disabled={!s.enabled}
              $disabled={!s.enabled}
              $selected={s.id === value}
              tabIndex={s.enabled ? 0 : -1}
              title={s.enabled ? undefined : t('common.comingSoon')}
              onClick={() => {
                if (!s.enabled) return;
                onChange(s.id);
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (!s.enabled) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(s.id);
                  setOpen(false);
                }
              }}
            >
              <span>{t(s.labelKey)}</span>
              {s.id === value && <CheckIcon />}
            </MenuItem>
          ))}
        </Menu>
      )}
    </Wrapper>
  );
}
