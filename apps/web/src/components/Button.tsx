// Shared Button primitive — variants `.btn-primary` / `.btn-ghost` /
// `.btn-dark` / `.btn-active` are routed through styled-components so theme
// overrides stay typed.

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import styled, { css } from 'styled-components';

export type ButtonVariant = 'primary' | 'ghost' | 'dark' | 'active';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const sizeStyles = {
  sm: css`
    padding: 4px 10px;
    font-size: 11.5px;
  `,
  md: css`
    padding: 6px 12px;
    font-size: 12.5px;
  `,
} as const;

const variantStyles = {
  primary: css`
    background: ${(p) => p.theme.colors.brandBase};
    border-color: ${(p) => p.theme.colors.brandBase};
    color: #fff;
    &:hover:not(:disabled) {
      background: ${(p) => p.theme.colors.brandHover};
      border-color: ${(p) => p.theme.colors.brandHover};
    }
    &:disabled {
      background: #edc8b7;
      border-color: #edc8b7;
      color: #fff;
      cursor: not-allowed;
    }
  `,
  ghost: css`
    background: transparent;
    border-color: transparent;
    color: ${(p) => p.theme.colors.fg200};
    &:hover:not(:disabled) {
      background: ${(p) => p.theme.colors.bg200};
    }
    &:disabled {
      color: ${(p) => p.theme.colors.fg400};
      cursor: not-allowed;
    }
  `,
  dark: css`
    background: ${(p) => p.theme.colors.fg100};
    border-color: ${(p) => p.theme.colors.fg100};
    color: ${(p) => p.theme.colors.bg50};
    &:hover:not(:disabled) {
      background: ${(p) => p.theme.colors.fg200};
      border-color: ${(p) => p.theme.colors.fg200};
    }
  `,
  active: css`
    background: ${(p) => p.theme.colors.brandBase};
    border-color: ${(p) => p.theme.colors.brandBase};
    color: #fff;
  `,
} as const;

const StyledButton = styled.button<{
  $variant: ButtonVariant;
  $size: ButtonSize;
}>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: ${(p) => p.theme.radius.sm};
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid ${(p) => p.theme.colors.line200};
  background: ${(p) => p.theme.colors.bg50};
  color: ${(p) => p.theme.colors.fg200};
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s;
  font-family: ${(p) => p.theme.fonts.sans};

  &:hover:not(:disabled) {
    background: ${(p) => p.theme.colors.bg200};
  }

  ${(p) => sizeStyles[p.$size]}
  ${(p) => variantStyles[p.$variant]}
`;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', leadingIcon, trailingIcon, children, ...rest },
  ref,
) {
  return (
    <StyledButton ref={ref} type="button" $variant={variant} $size={size} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </StyledButton>
  );
});
