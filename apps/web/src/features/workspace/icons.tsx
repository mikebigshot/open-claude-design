// Workspace 子组件用到的图标 —— 极简内联 SVG

interface IconProps {
  size?: number;
}

export function LogoIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 12 L12 3 L21 12 L12 21 Z" fill="#C96442" />
    </svg>
  );
}

export function ChevronIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
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

export function CloseIcon({ size = 11 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none" aria-hidden>
      <path d="M2 2L9 9M9 2L2 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function FileTabIcon({ size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <path d="M3 1.5h4.5L9.5 3.5V10a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" />
      <path d="M7 1.5V4h2.5" />
    </svg>
  );
}

export function FolderIcon({ size = 12 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <path d="M1.5 3.5L1.5 9.5a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V4.5a.5.5 0 00-.5-.5H6L5 2.5H2a.5.5 0 00-.5.5z" />
    </svg>
  );
}

export function PlusIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M6 2.5V9.5M2.5 6H9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Toolbar tools

export function SettingsIcon({ size = 13 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <circle cx="6.5" cy="6.5" r="1.7" />
      <path
        d="M6.5 1.5v1.4M6.5 10.1v1.4M1.5 6.5h1.4M10.1 6.5h1.4M3 3l1 1M9 9l1 1M3 10l1-1M9 4l1-1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CommentIcon({ size = 13 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <path d="M2 4a2 2 0 012-2h5a2 2 0 012 2v3a2 2 0 01-2 2H6L3.5 11V9H4a2 2 0 01-2-2V4z" />
    </svg>
  );
}

export function PenIcon({ size = 13 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <path d="M2 11l1-3 6-6 2 2-6 6-3 1z" strokeLinejoin="round" />
    </svg>
  );
}

export function SparkleIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" aria-hidden>
      <path
        d="M6.5 1L7.7 5.3L12 6.5L7.7 7.7L6.5 12L5.3 7.7L1 6.5L5.3 5.3L6.5 1Z"
        fill="currentColor"
        opacity={0.9}
      />
    </svg>
  );
}

export function ReloadIcon({ size = 13 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M11.5 6.5a5 5 0 11-1.5-3.6" />
      <path d="M11.5 1.5v3h-3" strokeLinejoin="round" />
    </svg>
  );
}

export function GlobeIcon({ size = 13 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <circle cx="6.5" cy="6.5" r="5" />
      <path d="M1.5 6.5h10M6.5 1.5c1.7 1.5 2.5 3.5 2.5 5s-.8 3.5-2.5 5c-1.7-1.5-2.5-3.5-2.5-5s.8-3.5 2.5-5z" />
    </svg>
  );
}

export function EyeIcon({ size = 13 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <path d="M1.5 6.5C2.8 4 4.5 2.5 6.5 2.5s3.7 1.5 5 4c-1.3 2.5-3 4-5 4s-3.7-1.5-5-4z" />
      <circle cx="6.5" cy="6.5" r="1.5" />
    </svg>
  );
}
