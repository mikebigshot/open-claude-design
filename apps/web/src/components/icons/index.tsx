// Lucide-style inline SVG icon set for the workspace.
//
// We deliberately do not depend on lucide-react — every glyph is a 10-line
// hand-rolled SVG. Stroke 1.6 default to read at 14px in the toolbar.

import type { CSSProperties, SVGProps } from 'react';

export interface IconProps {
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
  title?: string;
}

function svgProps(
  size: number | undefined,
  color: string | undefined,
  style: CSSProperties | undefined,
): SVGProps<SVGSVGElement> {
  return {
    width: size ?? 14,
    height: size ?? 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color ?? 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style,
  };
}

export function IconFile({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

export function IconFolder({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

export function IconSearch({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function IconPlus({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size ?? 12, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconChevron({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size ?? 12, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconCheck({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size ?? 12, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M5 12l4 4L19 7" />
    </svg>
  );
}

export function IconSparkle({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M12 3l1.6 4.5L18 9l-4.4 1.5L12 15l-1.6-4.5L6 9l4.4-1.5z" />
      <path d="M19 16l.7 1.8L21.5 18.5 19.7 19.2 19 21l-.7-1.8L16.5 18.5 18.3 17.8z" />
    </svg>
  );
}

export function IconPen({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M3 21l3.5-1L20 6.5a2 2 0 00-2.8-2.8L3.5 17.5z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

export function IconCursor({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M5 3l5 16 2.5-6.5L19 11z" />
    </svg>
  );
}

export function IconMic({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </svg>
  );
}

export function IconEye({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconGlobe({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13 13 0 010 18M12 3a13 13 0 000 18" />
    </svg>
  );
}

export function IconLock({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

export function IconDownload({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M12 3v12M6 11l6 6 6-6M5 21h14" />
    </svg>
  );
}

export function IconCopy({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1" />
    </svg>
  );
}

export function IconReload({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M21 12a9 9 0 11-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export function IconComment({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

export function IconSettings({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1A2 2 0 114.3 17l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1A2 2 0 117 4.3l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}

export function IconLogo({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size ?? 20, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function IconArrowUp({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function IconUndo({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a8 8 0 00-15-3" />
    </svg>
  );
}

export function IconPaperclip({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M21 12.5l-8.5 8.5a5 5 0 01-7-7L14 5.5a3.5 3.5 0 014.9 4.9l-8.5 8.5a2 2 0 01-2.8-2.8L15 8.5" />
    </svg>
  );
}

export function IconLink({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" />
      <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
    </svg>
  );
}

export function IconClose({ size, color, style, className, title }: IconProps) {
  return (
    <svg
      {...svgProps(size ?? 12, color, style)}
      className={className}
      aria-label={title}
      aria-hidden={!title}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export const Icons = {
  File: IconFile,
  Folder: IconFolder,
  Search: IconSearch,
  Plus: IconPlus,
  Chevron: IconChevron,
  Check: IconCheck,
  Sparkle: IconSparkle,
  Pen: IconPen,
  Cursor: IconCursor,
  Mic: IconMic,
  Eye: IconEye,
  Globe: IconGlobe,
  Lock: IconLock,
  Download: IconDownload,
  Copy: IconCopy,
  Reload: IconReload,
  Comment: IconComment,
  Settings: IconSettings,
  Logo: IconLogo,
  ArrowUp: IconArrowUp,
  Undo: IconUndo,
  Paperclip: IconPaperclip,
  Link: IconLink,
  Close: IconClose,
} as const;
