// 极简内联 SVG 图标 —— 仅 home 页用到的几个，避免引依赖

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

export function LogoIcon({ size = 22, color = '#C96442' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 12 L12 3 L21 12 L12 21 Z" fill={color} />
    </svg>
  );
}

export function ChevronIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path
        d="M2.5 6.5L4.5 8.5L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path
        d="M6 2.5V9.5M2.5 6H9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8.5 8.5L11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

