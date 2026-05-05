// css-to-tailwind — conservative CSS → Tailwind class mapping unit tests.

import { describe, expect, it } from 'vitest';
import {
  cssPropertyToTailwind,
  expandPrefixRemovals,
  extractClassNameFromOuterHTML,
} from './css-to-tailwind';

describe('cssPropertyToTailwind — background-color', () => {
  it('maps a stock Tailwind hex to bg-<token>', () => {
    expect(cssPropertyToTailwind('background-color', '#3B82F6')).toEqual({
      add: ['bg-blue-500'],
      removePrefixes: ['^bg-(?!opacity|gradient)'],
    });
  });

  it('is case-insensitive on hex values', () => {
    expect(cssPropertyToTailwind('background-color', '#3b82f6')).toMatchObject({
      add: ['bg-blue-500'],
    });
  });

  it('expands 3-digit hex shorthand', () => {
    expect(cssPropertyToTailwind('background-color', '#fff')).toMatchObject({
      add: ['bg-white'],
    });
  });

  it('parses rgb() format', () => {
    expect(cssPropertyToTailwind('background-color', 'rgb(59, 130, 246)')).toMatchObject({
      add: ['bg-blue-500'],
    });
  });

  it('skips rgba() with alpha < 1 (alpha not in V1 mapping)', () => {
    expect(cssPropertyToTailwind('background-color', 'rgba(59, 130, 246, 0.5)')).toBeNull();
  });

  it('accepts rgba() with explicit alpha=1', () => {
    expect(cssPropertyToTailwind('background-color', 'rgba(59, 130, 246, 1)')).toMatchObject({
      add: ['bg-blue-500'],
    });
  });

  it('maps named colors (white/black/red)', () => {
    expect(cssPropertyToTailwind('background-color', 'white')).toMatchObject({
      add: ['bg-white'],
    });
    expect(cssPropertyToTailwind('background-color', 'red')).toMatchObject({
      add: ['bg-red-500'],
    });
    expect(cssPropertyToTailwind('background-color', 'transparent')).toMatchObject({
      add: ['bg-transparent'],
    });
  });

  it('returns null for off-palette custom hex (caller falls back to inline style)', () => {
    expect(cssPropertyToTailwind('background-color', '#FAF9F5')).toBeNull();
    expect(cssPropertyToTailwind('background-color', '#141413')).toBeNull();
  });

  it('returns null for malformed hex', () => {
    expect(cssPropertyToTailwind('background-color', '#zzz')).toBeNull();
    expect(cssPropertyToTailwind('background-color', 'not-a-color')).toBeNull();
  });
});

describe('cssPropertyToTailwind — color', () => {
  it('maps to text-<token> with text-color removal pattern (not size/etc)', () => {
    const mapping = cssPropertyToTailwind('color', '#10b981');
    expect(mapping?.add).toEqual(['text-emerald-500']);
    // The remove pattern excludes text-xs / text-sm / text-base etc — we only
    // want to remove text COLORS, not text SIZES.
    expect(mapping?.removePrefixes[0]).toMatch(/text-/);
    expect(mapping?.removePrefixes[0]).toMatch(/xs|sm|base|lg/);
  });

  it('returns null for off-palette colors', () => {
    expect(cssPropertyToTailwind('color', '#abcdef')).toBeNull();
  });
});

describe('cssPropertyToTailwind — unsupported properties', () => {
  it('returns null for properties without a handler', () => {
    expect(cssPropertyToTailwind('font-family', 'Inter')).toBeNull();
    expect(cssPropertyToTailwind('z-index', '5')).toBeNull();
    expect(cssPropertyToTailwind('display', 'flex')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// expandPrefixRemovals
// ─────────────────────────────────────────────────────────────────────────────

describe('expandPrefixRemovals', () => {
  it('returns the concrete classes matching the regex prefixes', () => {
    expect(
      expandPrefixRemovals('bg-red-500 text-white p-4 bg-opacity-50', ['^bg-(?!opacity|gradient)']),
    ).toEqual(['bg-red-500']);
  });

  it('returns multiple matches when more than one class fits the prefix', () => {
    expect(
      expandPrefixRemovals('text-sm text-gray-500 text-emerald-500', [
        '^text-(?!xs|sm|base|lg|xl|2xl|3xl)',
      ]),
    ).toEqual(['text-gray-500', 'text-emerald-500']);
  });

  it('handles empty prefix list', () => {
    expect(expandPrefixRemovals('a b c', [])).toEqual([]);
  });

  it('handles empty class list', () => {
    expect(expandPrefixRemovals('', ['^bg-'])).toEqual([]);
  });

  it('preserves classes that do not match any pattern', () => {
    expect(expandPrefixRemovals('p-4 m-2 rounded', ['^bg-'])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration shape — what PreviewPanel will consume
// ─────────────────────────────────────────────────────────────────────────────

describe('extractClassNameFromOuterHTML', () => {
  it('extracts the JSX className value', () => {
    expect(extractClassNameFromOuterHTML('<button className="bg-red-500 p-4">x</button>')).toBe(
      'bg-red-500 p-4',
    );
  });

  it('extracts the HTML class= value (DOM-rendered form)', () => {
    expect(extractClassNameFromOuterHTML('<button class="bg-red-500">x</button>')).toBe(
      'bg-red-500',
    );
  });

  it('handles single-quoted attributes', () => {
    expect(extractClassNameFromOuterHTML("<div class='x y'>z</div>")).toBe('x y');
  });

  it('returns empty string when no class attribute is present', () => {
    expect(extractClassNameFromOuterHTML('<div>x</div>')).toBe('');
  });

  it('returns empty string when class attribute is empty', () => {
    expect(extractClassNameFromOuterHTML('<div class="">x</div>')).toBe('');
  });
});

describe('PreviewPanel-facing flow', () => {
  it('round-trip: stock blue → bg-blue-500 with bg-* removal', () => {
    const mapping = cssPropertyToTailwind('background-color', '#3B82F6');
    expect(mapping).not.toBeNull();
    const removeList = expandPrefixRemovals('bg-red-500 text-white p-4', mapping!.removePrefixes);
    expect(mapping!.add).toEqual(['bg-blue-500']);
    expect(removeList).toEqual(['bg-red-500']);
  });
});
