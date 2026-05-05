// 保真度卡片：Wireframe / High fidelity 两个选项

import styled, { css } from 'styled-components';

import type { Fidelity } from '@open-design/contracts';

interface FidelityCardProps {
  label: string;
  active: boolean;
  kind: 'wire' | 'hifi';
  fidelity: Fidelity;
  onSelect: (f: Fidelity) => void;
  disabled?: boolean;
}

const CardBtn = styled.button<{ $active: boolean; $disabled: boolean }>`
  padding: 0;
  border-radius: 8px;
  background: ${(p) => (p.$active ? p.theme.colors.brandTint : p.theme.colors.bg50)};
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  overflow: hidden;
  display: block;
  width: 100%;
  text-align: left;
  font-family: inherit;
  transition:
    border-color 0.14s,
    background 0.14s;
  ${(p) =>
    p.$active
      ? css`
          border: 2px solid ${p.theme.colors.brandBase};
        `
      : css`
          border: 1px solid ${p.theme.colors.line200};
        `}

  &:hover {
    ${(p) =>
      !p.$disabled &&
      !p.$active &&
      css`
        background: ${p.theme.colors.bg200};
      `}
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const Thumb = styled.div<{ $active: boolean }>`
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => (p.$active ? 'transparent' : p.theme.colors.bg200)};
`;

const Label = styled.div<{ $active: boolean }>`
  padding: 6px 0 8px;
  font-size: 11.5px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  color: ${(p) => (p.$active ? p.theme.colors.brandPress : p.theme.colors.fg200)};
  text-align: center;
`;

export function FidelityCard({
  label,
  active,
  kind,
  fidelity,
  onSelect,
  disabled = false,
}: FidelityCardProps) {
  return (
    <CardBtn
      type="button"
      onClick={() => !disabled && onSelect(fidelity)}
      $active={active}
      $disabled={disabled}
      disabled={disabled}
      aria-pressed={active}
    >
      <Thumb $active={active}>
        {kind === 'wire' ? (
          <svg
            width="80"
            height="50"
            viewBox="0 0 80 50"
            fill="none"
            stroke="#5A574F"
            strokeWidth="1.2"
          >
            <rect x="6" y="6" width="68" height="38" rx="2" fill="#fff" />
            <rect x="12" y="12" width="22" height="3" />
            <rect x="12" y="18" width="34" height="2" />
            <rect x="12" y="24" width="56" height="2" />
            <rect x="12" y="28" width="44" height="2" />
            <rect x="12" y="35" width="16" height="6" rx="1" fill="#E9E6DC" />
          </svg>
        ) : (
          <svg width="80" height="50" viewBox="0 0 80 50" fill="none">
            <rect x="6" y="6" width="68" height="38" rx="3" fill="#fff" stroke="#DDD8C8" />
            <rect x="12" y="12" width="22" height="3" rx="1" fill="#141413" />
            <rect x="12" y="19" width="40" height="2" rx="1" fill="#8A8678" />
            <rect x="12" y="24" width="34" height="2" rx="1" fill="#8A8678" />
            <rect x="42" y="32" width="14" height="8" rx="2" fill="#C96442" />
            <circle cx="62" cy="36" r="4" fill="#F3E7DF" />
          </svg>
        )}
      </Thumb>
      <Label $active={active}>{label}</Label>
    </CardBtn>
  );
}
