// FileRow primitive — used in the file tree, the chat tools list, and the
// share popover items. Purely presentational — click handling and selection
// state are passed in.

import type { MouseEvent, ReactNode } from 'react';
import styled from 'styled-components';

export interface FileRowProps {
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  className?: string;
  /** Trailing element rendered to the right of `meta` (e.g. chevron). */
  trailing?: ReactNode;
  /** Optional sub-label shown beneath `label` (used in share popover). */
  subLabel?: ReactNode;
  disabled?: boolean;
}

const Row = styled.div<{ $selected: boolean; $clickable: boolean; $disabled: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: ${(p) => p.theme.radius.sm};
  font-size: 12.5px;
  font-family: ${(p) => p.theme.fonts.sans};
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : p.$clickable ? 'pointer' : 'default')};
  opacity: ${(p) => (p.$disabled ? 0.5 : 1)};
  background: ${(p) => (p.$selected ? p.theme.colors.bg300 : 'transparent')};
  color: ${(p) => p.theme.colors.fg200};
  transition: background 0.1s;

  &:hover {
    background: ${(p) =>
      p.$disabled
        ? p.$selected
          ? p.theme.colors.bg300
          : 'transparent'
        : p.$selected
          ? p.theme.colors.bg300
          : p.theme.colors.bg200};
  }
`;

const IconCell = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
`;

const LabelStack = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
`;

const Label = styled.div`
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SubLabel = styled.div`
  font-size: 10.5px;
  color: ${(p) => p.theme.colors.fg400};
`;

const Meta = styled.span`
  margin-left: auto;
  font-size: 11.5px;
  color: ${(p) => p.theme.colors.fg400};
  display: flex;
  gap: 14px;
  align-items: center;
`;

export function FileRow({
  icon,
  label,
  meta,
  selected = false,
  onClick,
  className,
  trailing,
  subLabel,
  disabled = false,
}: FileRowProps) {
  return (
    <Row
      className={className}
      $selected={selected}
      $clickable={Boolean(onClick) && !disabled}
      $disabled={disabled}
      onClick={disabled ? undefined : onClick}
    >
      {icon ? <IconCell>{icon}</IconCell> : null}
      <LabelStack>
        <Label>{label}</Label>
        {subLabel ? <SubLabel>{subLabel}</SubLabel> : null}
      </LabelStack>
      {meta ? <Meta>{meta}</Meta> : null}
      {trailing}
    </Row>
  );
}
