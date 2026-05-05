// Inline SVG icon set for the chat panel.
// Lightweight — no lucide-react dep. Stroke 1.5 throughout for visual coherence.

import type { CSSProperties } from 'react';

export interface IconProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}

const base = (
  size = 14,
  color = 'currentColor',
  style?: CSSProperties,
): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style,
});

export function IconSparkle({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size, color, style)} className={className} aria-hidden="true">
      <path d="M12 3l1.6 4.5L18 9l-4.4 1.5L12 15l-1.6-4.5L6 9l4.4-1.5z" />
      <path d="M19 16l.7 1.8L21.5 18.5 19.7 19.2 19 21l-.7-1.8L16.5 18.5 18.3 17.8z" />
    </svg>
  );
}

export function IconLogo({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size ?? 12, color, style)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function IconPlus({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size ?? 12, color, style)} className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconPaperclip({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size, color, style)} className={className} aria-hidden="true">
      <path d="M21 12.5l-8.5 8.5a5 5 0 01-7-7L14 5.5a3.5 3.5 0 014.9 4.9l-8.5 8.5a2 2 0 01-2.8-2.8L15 8.5" />
    </svg>
  );
}

export function IconMic({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size, color, style)} className={className} aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </svg>
  );
}

export function IconChevron({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size ?? 12, color, style)} className={className} aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconCheck({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size ?? 12, color, style)} className={className} aria-hidden="true">
      <path d="M5 12l4 4L19 7" />
    </svg>
  );
}

export function IconArrowUp({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size ?? 14, color, style)} className={className} aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function IconFolder({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size, color, style)} className={className} aria-hidden="true">
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

export function IconLink({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size, color, style)} className={className} aria-hidden="true">
      <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" />
      <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
    </svg>
  );
}

export function IconGlobe({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size, color, style)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13 13 0 010 18M12 3a13 13 0 000 18" />
    </svg>
  );
}

export function IconClose({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size ?? 12, color, style)} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconTrash({ size, color, style, className }: IconProps) {
  return (
    <svg {...base(size ?? 12, color, style)} className={className} aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    </svg>
  );
}
