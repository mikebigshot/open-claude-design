// Popover — generic dismiss-aware popover container.
//
// - closes on outside click (mousedown listener attached to document)
// - closes on ESC keypress
// - stops click propagation on its body so child clicks don't trigger
//   parent close handlers (matches prototype's <SharePopover> behavior)
//
// Positioning is the caller's responsibility via `style` (absolute / fixed
// depending on parent containing block).

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import styled from 'styled-components';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  /** Disable outside-click dismiss (useful when nested inside another popover). */
  disableOutsideClose?: boolean;
}

const Shell = styled.div`
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 12px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  z-index: 60;
  font-family: ${(p) => p.theme.fonts.sans};
  color: ${(p) => p.theme.colors.fg100};
`;

export function Popover({
  open,
  onClose,
  children,
  style,
  className,
  disableOutsideClose = false,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    function onDocumentMouseDown(event: MouseEvent) {
      if (disableOutsideClose) return;
      const node = ref.current;
      if (!node) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      onClose();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, disableOutsideClose]);

  if (!open) return null;

  return (
    <Shell
      ref={ref}
      className={className}
      style={style}
      role="dialog"
      onClick={(event) => {
        // Prevent ancestor "click-anywhere-to-close" handlers from firing.
        event.stopPropagation();
      }}
    >
      {children}
    </Shell>
  );
}
