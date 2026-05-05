// Compact language switcher rendered as a small pill button. Click to open
// a menu of supported locales; selecting one persists to localStorage and
// updates <html lang>. Mirrors nexu open-design's UX pattern but rebuilt
// against our styled-components theme.

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

import { LOCALE_LABEL, LOCALES, useI18n, type Locale } from '@/i18n';

type Variant = 'pill' | 'compact' | 'rail';

interface LanguageMenuProps {
  /**
   * Visual variant:
   *  - `pill` (default) — inline use, hugs its content
   *  - `compact` — tight rows
   *  - `rail` — full-width block, mirrors RailApiKeyButton on Home so the two
   *    bottom-rail entries (API keys + Language) read as a matched pair
   */
  variant?: Variant;
}

const Wrap = styled.div<{ $variant: Variant }>`
  position: relative;
  display: ${(p) => (p.$variant === 'rail' ? 'block' : 'inline-block')};
  ${(p) => (p.$variant === 'rail' ? 'width: 100%;' : '')}
`;

const Trigger = styled.button<{ $variant: Variant }>`
  display: ${(p) => (p.$variant === 'rail' ? 'flex' : 'inline-flex')};
  align-items: center;
  gap: ${(p) => (p.$variant === 'rail' ? '8px' : '6px')};
  padding: ${(p) =>
    p.$variant === 'compact' ? '4px 8px' : p.$variant === 'rail' ? '7px 10px' : '6px 10px'};
  ${(p) => (p.$variant === 'rail' ? 'width: 100%;' : '')}
  background: transparent;
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 8px;
  color: ${(p) => p.theme.colors.fg300};
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  text-align: ${(p) => (p.$variant === 'rail' ? 'left' : 'center')};
  white-space: nowrap;
  transition:
    background 0.14s,
    color 0.14s,
    border-color 0.14s;

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg100};
    border-color: ${(p) => p.theme.colors.line100};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const TriggerSpacer = styled.span`
  flex: 1;
`;

const TriggerLabel = styled.span`
  font-weight: 500;
`;

const Caret = styled.span`
  font-size: 9px;
  opacity: 0.7;
`;

const Menu = styled.div`
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 180px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 10px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 4px;
  z-index: 80;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Item = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: ${(p) => (p.$active ? p.theme.colors.bg200 : 'transparent')};
  border: none;
  border-radius: 6px;
  color: ${(p) => p.theme.colors.fg100};
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: -2px;
  }
`;

const ItemLabel = styled.span`
  flex: 1;
  font-weight: 500;
`;

const ItemCode = styled.span`
  color: ${(p) => p.theme.colors.fg400};
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 10.5px;
`;

const Check = styled.span`
  color: ${(p) => p.theme.colors.brandBase};
  font-weight: 600;
`;

export function LanguageMenu({ variant = 'pill' }: LanguageMenuProps) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <Wrap ref={wrapRef} $variant={variant}>
      <Trigger
        type="button"
        $variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('lang.menuAria')}
        title={t('lang.tooltip')}
        onClick={() => setOpen((v) => !v)}
        data-testid="language-menu-trigger"
      >
        <span aria-hidden="true">🌐</span>
        <TriggerLabel>{LOCALE_LABEL[locale]}</TriggerLabel>
        {variant === 'rail' && <TriggerSpacer />}
        <Caret aria-hidden="true">▾</Caret>
      </Trigger>
      {open && (
        <Menu role="menu" data-testid="language-menu-popover">
          {LOCALES.map((code) => {
            const active = code === locale;
            return (
              <Item
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                $active={active}
                onClick={() => {
                  setLocale(code as Locale);
                  setOpen(false);
                }}
                data-testid={`language-menu-item-${code}`}
              >
                <ItemLabel>{LOCALE_LABEL[code]}</ItemLabel>
                <ItemCode>{code}</ItemCode>
                {active && (
                  <Check aria-hidden="true">✓</Check>
                )}
              </Item>
            );
          })}
        </Menu>
      )}
    </Wrap>
  );
}
