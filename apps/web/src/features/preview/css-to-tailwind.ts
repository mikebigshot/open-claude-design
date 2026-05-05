// Conservative CSS-property → Tailwind-class mapping for Edit-mode write-back.
//
// Goal (P2-8): when the user nudges background-color via EditFloat, prefer
// writing `className="bg-blue-500"` over `style={{backgroundColor:'#3B82F6'}}`
// — but only when we have a HIGH-CONFIDENCE mapping. For unmapped values
// (custom hex, rgba with alpha, css variables, etc.) the caller falls back
// to the inline-style write-back path so user intent is never silently lost.
//
// Coverage policy: only the stock Tailwind v3 default palette plus a few
// utility props (text-color / spacing). Custom theme tokens (`bg-page`) are
// not derivable from CSS values without knowing the user's tailwind.config,
// so we don't try.
//
// IMPORTANT: a NULL return is a positive signal — caller should fall back to
// inline style. Returning `{add: [], remove: []}` is reserved for "value
// already maps to no class change" (a no-op, e.g. transparent background).

export interface ClassMapping {
  add: string[];
  /**
   * Class prefixes to strip from the existing className list. Tailwind classes
   * are mutually-exclusive within a prefix family (only one `bg-*` should be
   * active at a time), so we tell the AST writer to remove any class matching
   * a prefix in this list before adding the new one. Patterns are concrete
   * regex-style strings (e.g. `^bg-` to match all `bg-*`).
   */
  removePrefixes: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TAILWIND_DEFAULT_COLORS_HEX: Record<string, string> = {
  // Subset of Tailwind v3 default palette — most-used shades only.
  '#ffffff': 'white',
  '#000000': 'black',
  // gray
  '#f3f4f6': 'gray-100',
  '#e5e7eb': 'gray-200',
  '#d1d5db': 'gray-300',
  '#9ca3af': 'gray-400',
  '#6b7280': 'gray-500',
  '#4b5563': 'gray-600',
  '#374151': 'gray-700',
  '#1f2937': 'gray-800',
  '#111827': 'gray-900',
  // red
  '#fee2e2': 'red-100',
  '#fecaca': 'red-200',
  '#f87171': 'red-400',
  '#ef4444': 'red-500',
  '#dc2626': 'red-600',
  '#b91c1c': 'red-700',
  // emerald (Tailwind's green-of-choice)
  '#d1fae5': 'emerald-100',
  '#34d399': 'emerald-400',
  '#10b981': 'emerald-500',
  '#059669': 'emerald-600',
  // blue
  '#dbeafe': 'blue-100',
  '#60a5fa': 'blue-400',
  '#3b82f6': 'blue-500',
  '#2563eb': 'blue-600',
  '#1e40af': 'blue-800',
  // amber
  '#fef3c7': 'amber-100',
  '#fbbf24': 'amber-400',
  '#f59e0b': 'amber-500',
  '#d97706': 'amber-600',
};

const NAMED_COLORS: Record<string, string> = {
  white: 'white',
  black: 'black',
  red: 'red-500',
  blue: 'blue-500',
  green: 'emerald-500',
  yellow: 'amber-400',
  gray: 'gray-500',
  grey: 'gray-500',
  transparent: 'transparent',
};

function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  // Match #rgb / #rrggbb (no alpha for V1 — alpha needs Tailwind/opacity sigil).
  const match = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!match) return null;
  const body = match[1]!;
  if (body.length === 3) {
    const [r, g, b] = body;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return `#${body}`;
}

/** Parse `rgb(r, g, b)` into a normalized hex. Alpha-bearing forms not supported. */
function rgbToHex(value: string): string | null {
  const m = value
    .trim()
    .match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)\s*(?:[,/]\s*([0-9.]+))?\s*\)$/i);
  if (!m) return null;
  const a = m[4];
  // Skip rgba-with-alpha (needs Tailwind opacity sigil; conservative skip).
  if (a !== undefined && a !== '1' && a !== '1.0') return null;
  const [, r, g, b] = m;
  const toHex = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${toHex(r!)}${toHex(g!)}${toHex(b!)}`;
}

function colorValueToTailwindToken(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (NAMED_COLORS[trimmed]) return NAMED_COLORS[trimmed]!;
  const hex = normalizeHex(trimmed) ?? rgbToHex(trimmed);
  if (!hex) return null;
  return TAILWIND_DEFAULT_COLORS_HEX[hex] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Property handlers
// ─────────────────────────────────────────────────────────────────────────────

type Handler = (value: string) => ClassMapping | null;

const HANDLERS: Record<string, Handler> = {
  'background-color': (value) => {
    const token = colorValueToTailwindToken(value);
    if (!token) return null;
    if (token === 'transparent') {
      return { add: ['bg-transparent'], removePrefixes: ['^bg-(?!opacity)'] };
    }
    return { add: [`bg-${token}`], removePrefixes: ['^bg-(?!opacity|gradient)'] };
  },
  color: (value) => {
    const token = colorValueToTailwindToken(value);
    if (!token) return null;
    return { add: [`text-${token}`], removePrefixes: ['^text-(?!xs|sm|base|lg|xl|2xl|3xl)'] };
  },
};

/**
 * Map a single CSS property/value pair to a Tailwind class change.
 *
 * Returns `null` when no high-confidence mapping exists — the caller should
 * fall back to inline-style write-back so the user's edit survives.
 */
export function cssPropertyToTailwind(property: string, value: string): ClassMapping | null {
  const handler = HANDLERS[property.toLowerCase()];
  if (!handler) return null;
  return handler(value);
}

/**
 * Expand a class mapping's `removePrefixes` regex hints against an existing
 * className list, returning the concrete classes to remove. Caller passes
 * this through to applyClassChangeToSource as `change.remove`.
 *
 * Exported so PreviewPanel can compute the concrete remove list when it
 * has access to the live element's current className (via ELEMENT_SELECTED).
 */
export function expandPrefixRemovals(
  currentClassList: string,
  removePrefixes: readonly string[],
): string[] {
  if (removePrefixes.length === 0) return [];
  const regexes = removePrefixes.map((p) => new RegExp(p));
  const tokens = currentClassList.split(/\s+/).filter(Boolean);
  return tokens.filter((t) => regexes.some((r) => r.test(t)));
}

/**
 * Extract the className string from the outerHTML snippet captured at
 * ELEMENT_SELECTED time. Handles both HTML (`class="..."`) and JSX-like
 * (`className="..."`) attribute spellings since the iframe's overlay sees
 * the rendered DOM, where attributes appear as `class=` even for JSX
 * artifacts. Returns an empty string when no class attribute is present
 * — caller treats that as "no classes to remove".
 */
export function extractClassNameFromOuterHTML(outerHTML: string): string {
  const match = outerHTML.match(/\s(?:className|class)\s*=\s*(["'])([^"']*)\1/);
  return match?.[2] ?? '';
}
