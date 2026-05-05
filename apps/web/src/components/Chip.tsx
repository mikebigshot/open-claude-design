// Chip primitive — two flavors:
//   1. plain chip (label only or label + close × button)
//   2. dashed-add chip (used as "Add context" button — dashed border + plus)

import type { MouseEvent, ReactNode } from 'react';
import styled from 'styled-components';
import { IconPlus, IconClose } from './Icon';

export interface ChipProps {
  label: string;
  leadingIcon?: ReactNode;
  onRemove?: (event: MouseEvent<HTMLButtonElement>) => void;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
}

const ChipShell = styled.div<{ $clickable: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 7px;
  border-radius: 999px;
  font-size: 11.5px;
  background: ${(p) => p.theme.colors.bg200};
  color: ${(p) => p.theme.colors.fg200};
  border: 1px solid ${(p) => p.theme.colors.line100};
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  font-family: ${(p) => p.theme.fonts.sans};
`;

const ChipClose = styled.button`
  background: transparent;
  border: none;
  padding: 0;
  margin-left: 2px;
  color: ${(p) => p.theme.colors.fg400};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  &:hover {
    color: ${(p) => p.theme.colors.fg200};
  }
`;

export function Chip({ label, leadingIcon, onRemove, onClick, className }: ChipProps) {
  return (
    <ChipShell className={className} $clickable={Boolean(onClick)} onClick={onClick}>
      {leadingIcon}
      <span>{label}</span>
      {onRemove ? (
        <ChipClose
          type="button"
          aria-label={`Remove ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(event);
          }}
        >
          <IconClose size={11} />
        </ChipClose>
      ) : null}
    </ChipShell>
  );
}

const DashedShell = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px 3px 7px;
  border-radius: 999px;
  font-size: 11.5px;
  background: transparent;
  color: ${(p) => p.theme.colors.fg300};
  border: 1px dashed ${(p) => p.theme.colors.line200};
  cursor: pointer;
  font-family: ${(p) => p.theme.fonts.sans};

  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    border-color: ${(p) => p.theme.colors.line300};
    color: ${(p) => p.theme.colors.fg200};
  }
`;

export interface DashedAddChipProps {
  label: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

export function DashedAddChip({ label, onClick, className }: DashedAddChipProps) {
  return (
    <DashedShell type="button" className={className} onClick={onClick}>
      <IconPlus size={11} />
      <span>{label}</span>
    </DashedShell>
  );
}
