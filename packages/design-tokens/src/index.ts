// Design tokens — single source of truth, mirrored to CSS in tokens.css.
// Keep this file and tokens.css in sync; they're consumed in different runtimes.

export const tokens = {
  colors: {
    // Backgrounds (warm off-white scale)
    bg50: '#FCFBF8',
    bg100: '#FAF9F5',
    bg200: '#F3F1EA',
    bg300: '#E9E6DC',
    bg400: '#DCD9CC',
    bg500: '#C9C5B5',

    // Foreground (warm graphite)
    fg100: '#141413',
    fg200: '#2C2A26',
    fg300: '#5A574F',
    fg400: '#8A8678',
    fg500: '#B8B5AC',

    // Brand (warm orange)
    brandBase: '#C96442',
    brandHover: '#B5553A',
    brandPress: '#9E4A32',
    brandSoft: '#F3E7DF',
    brandTint: '#FBF1EB',

    // Semantic
    success: '#5C8A53',
    info: '#4A6FA5',
    danger: '#C24545',
    warn: '#D49A3F',

    // Lines
    line100: '#ECE9DF',
    line200: '#DDD8C8',
    line300: '#C8C2AE',
  },

  shadows: {
    sm: '0 1px 2px rgba(20,20,19,0.04), 0 1px 1px rgba(20,20,19,0.03)',
    md: '0 4px 12px rgba(20,20,19,0.06), 0 2px 4px rgba(20,20,19,0.04)',
    lg: '0 16px 36px rgba(20,20,19,0.10), 0 4px 12px rgba(20,20,19,0.06)',
  },

  radius: {
    sm: '6px',
    md: '10px',
    lg: '14px',
    xl: '20px',
  },

  fonts: {
    serif: '"Instrument Serif", "Source Serif 4", Georgia, serif',
    sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  },
} as const;

export type Tokens = typeof tokens;
