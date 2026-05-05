// Tab primitive — underline-style tab.
//
// Inactive tabs are muted (fg-400). Active tab is bold fg-100 with a
// 1.5px solid underline.

import type { MouseEvent, ReactNode } from 'react';
import styled from 'styled-components';

export interface TabProps {
  active?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
}

const TabButton = styled.button<{ $active: boolean }>`
  background: transparent;
  border: none;
  padding: 10px 4px;
  margin: 0 18px 0 0;
  font-size: 12.5px;
  font-family: ${(p) => p.theme.fonts.sans};
  cursor: pointer;
  color: ${(p) => (p.$active ? p.theme.colors.fg100 : p.theme.colors.fg400)};
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  border-bottom: 1.5px solid ${(p) => (p.$active ? p.theme.colors.fg100 : 'transparent')};

  &:hover {
    color: ${(p) => p.theme.colors.fg200};
  }
`;

export function Tab({ active = false, onClick, children, className }: TabProps) {
  return (
    <TabButton
      type="button"
      className={className}
      $active={active}
      onClick={onClick}
      role="tab"
      aria-selected={active}
    >
      {children}
    </TabButton>
  );
}
