// FloatPanel — generic floating panel shell used by the Tweaks / Edit popovers.
//   - title row with optional close (×) button
//   - body slot
//   - shadow + rounded border, absolute positioned by the caller's `style`

import type { CSSProperties, ReactNode } from 'react';
import styled from 'styled-components';
import { IconClose } from './Icon';

export interface FloatPanelProps {
  title: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  width?: number | string;
  className?: string;
  style?: CSSProperties;
}

const Panel = styled.div`
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 12px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  font-family: ${(p) => p.theme.fonts.sans};
  color: ${(p) => p.theme.colors.fg100};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid ${(p) => p.theme.colors.line100};
`;

const Title = styled.strong`
  font-size: 12px;
  font-weight: 600;
`;

const CloseButton = styled.button`
  margin-left: auto;
  background: transparent;
  border: none;
  padding: 2px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  color: ${(p) => p.theme.colors.fg400};
  border-radius: 4px;
  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg200};
  }
`;

const Body = styled.div`
  padding: 12px;
`;

export function FloatPanel({
  title,
  children,
  onClose,
  width = 260,
  className,
  style,
}: FloatPanelProps) {
  const mergedStyle: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    ...style,
  };
  return (
    <Panel className={className} style={mergedStyle}>
      <Header>
        <Title>{title}</Title>
        {onClose ? (
          <CloseButton type="button" aria-label="Close" onClick={onClose}>
            <IconClose size={12} />
          </CloseButton>
        ) : null}
      </Header>
      <Body>{children}</Body>
    </Panel>
  );
}
