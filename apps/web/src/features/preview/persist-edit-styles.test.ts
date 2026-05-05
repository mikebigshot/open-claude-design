import { describe, expect, it } from 'vitest';

import { applyInlineStyleToSource, mergePendingEdit } from './persist-edit-styles';
import { findSourceMatch } from './persist-edit-utils';

describe('applyInlineStyleToSource', () => {
  describe('HTML', () => {
    it('appends style attribute when none exists', () => {
      const source = '<button class="primary">Click</button>';
      const next = applyInlineStyleToSource(source, 'index.html', source, {
        'background-color': '#3B82F6',
      });
      expect(next).toBe('<button class="primary" style="background-color: #3B82F6">Click</button>');
    });

    it('merges new properties into existing style attribute', () => {
      const source = '<button style="color: red; padding: 8px">Click</button>';
      const next = applyInlineStyleToSource(source, 'page.html', source, {
        'background-color': '#3B82F6',
      });
      expect(next).toContain('color: red');
      expect(next).toContain('padding: 8px');
      expect(next).toContain('background-color: #3B82F6');
    });

    it('overrides existing same-named property in style attribute', () => {
      const source = '<div style="color: red">Hi</div>';
      const next = applyInlineStyleToSource(source, 'index.html', source, { color: 'blue' });
      expect(next).toBe('<div style="color: blue">Hi</div>');
    });

    it('returns source unchanged when snippet not found', () => {
      const source = '<button class="x">Click</button>';
      const snippet = '<input type="text" />';
      const next = applyInlineStyleToSource(source, 'index.html', snippet, { color: 'blue' });
      expect(next).toBe(source);
    });

    it('only mutates the first matching opening tag, leaves the rest', () => {
      const source = '<button>One</button>\n<button>Two</button>';
      const snippet = '<button>One</button>';
      const next = applyInlineStyleToSource(source, 'page.html', snippet, { color: 'red' });
      expect(next).toBe('<button style="color: red">One</button>\n<button>Two</button>');
    });

    it('handles single-quoted style attribute', () => {
      const source = "<p style='font-size: 12px'>x</p>";
      const next = applyInlineStyleToSource(source, 'index.html', source, { color: 'red' });
      expect(next).toContain('font-size: 12px');
      expect(next).toContain('color: red');
    });

    it('handles self-closing tags', () => {
      const source = '<img src="x.png" />';
      const next = applyInlineStyleToSource(source, 'index.html', source, { width: '100px' });
      expect(next).toBe('<img src="x.png" style="width: 100px" />');
    });
  });

  describe('JSX', () => {
    it('appends style={{...}} prop when none exists', () => {
      const source = '<button className="primary">Click</button>';
      const next = applyInlineStyleToSource(source, 'App.jsx', source, {
        'background-color': '#3B82F6',
      });
      expect(next).toBe(
        '<button className="primary" style={{ backgroundColor: "#3B82F6" }}>Click</button>',
      );
    });

    it('converts kebab-case CSS prop to camelCase JSX key', () => {
      const source = '<div>x</div>';
      const next = applyInlineStyleToSource(source, 'App.jsx', source, {
        'font-size': '14px',
        'border-bottom-width': '2px',
      });
      expect(next).toContain('fontSize: "14px"');
      expect(next).toContain('borderBottomWidth: "2px"');
    });

    it('merges into existing style={{...}} object literal', () => {
      const source = '<div style={{ color: "red", padding: "8px" }}>x</div>';
      const next = applyInlineStyleToSource(source, 'App.jsx', source, { 'font-size': '14px' });
      expect(next).toContain('color: "red"');
      expect(next).toContain('padding: "8px"');
      expect(next).toContain('fontSize: "14px"');
    });

    it('overrides existing same-named JSX style key', () => {
      const source = '<div style={{ color: "red" }}>x</div>';
      const next = applyInlineStyleToSource(source, 'App.jsx', source, { color: 'blue' });
      expect(next).toBe('<div style={{ color: "blue" }}>x</div>');
    });

    it('returns source unchanged when snippet not found', () => {
      const source = '<div className="other">x</div>';
      const snippet = '<button className="primary">Click</button>';
      const next = applyInlineStyleToSource(source, 'App.jsx', snippet, { color: 'red' });
      expect(next).toBe(source);
    });

    it('handles self-closing JSX tag', () => {
      const source = '<input type="text" />';
      const next = applyInlineStyleToSource(source, 'App.jsx', source, { width: '100%' });
      expect(next).toBe('<input type="text" style={{ width: "100%" }} />');
    });

    it('treats .tsx like .jsx', () => {
      const source = '<span>x</span>';
      const next = applyInlineStyleToSource(source, 'App.tsx', source, { color: 'green' });
      expect(next).toContain('style={{ color: "green" }}');
    });

    it('falls back to JSX path for unknown extensions', () => {
      const source = '<span>x</span>';
      const next = applyInlineStyleToSource(source, 'something.weird', source, { color: 'red' });
      // unknown ext → JSX-style output (safer because source might be a fragment)
      expect(next).toContain('style={{');
    });
  });

  describe('idempotence + edge cases', () => {
    it('returns identical source when styles is empty', () => {
      const source = '<div>x</div>';
      const next = applyInlineStyleToSource(source, 'index.html', source, {});
      expect(next).toBe(source);
    });

    it('does not double-write when invoked twice with the same styles', () => {
      const source = '<div>x</div>';
      const once = applyInlineStyleToSource(source, 'App.jsx', source, { color: 'red' });
      const twice = applyInlineStyleToSource(once, 'App.jsx', source, { color: 'red' });
      // second invocation can't find raw snippet anymore (already mutated) → no-op
      expect(twice).toBe(once);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createElement-style fallback (P2-12) — applyInlineStyleToSource needs to
// find the source location even when the source is `React.createElement(...)`
// rather than a JSX literal, or when JSX prop order doesn't match the rendered
// outerHTML byte-for-byte.
// ─────────────────────────────────────────────────────────────────────────────

describe('applyInlineStyleToSource — createElement-style source (P2-12 fallback)', () => {
  it('finds and mutates the target inside a React.createElement call', () => {
    const source =
      'export default function App() {\n' +
      '  return React.createElement("button", { className: "primary" }, "Click");\n' +
      '}';
    const snippet = '<button class="primary">Click</button>';
    const next = applyInlineStyleToSource(source, 'App.jsx', snippet, { color: 'red' });
    // Should have injected a style prop into the createElement props object.
    expect(next).not.toBe(source);
    expect(next).toContain('color: "red"');
  });

  it('finds JSX target when prop order differs from rendered outerHTML', () => {
    // outerHTML returns attrs in DOM order (alphabetized in some shapes); JSX
    // source has them in author order. The literal `source.includes(snippet)`
    // grep used to fail here.
    const source =
      'export default function App() {\n' +
      '  return <button onClick={fn} className="primary">Click</button>;\n' +
      '}';
    // Snippet has className first (DOM order)
    const snippet = '<button class="primary">Click</button>';
    const next = applyInlineStyleToSource(source, 'App.jsx', snippet, { color: 'red' });
    expect(next).not.toBe(source);
    expect(next).toContain('color: "red"');
  });

  it('mutates createElement when style prop already present', () => {
    const source =
      'export default function App() {\n' +
      '  return React.createElement("div", { style: { padding: "8px" }, className: "card" });\n' +
      '}';
    const snippet = '<div class="card"></div>';
    const next = applyInlineStyleToSource(source, 'App.jsx', snippet, { color: 'blue' });
    expect(next).not.toBe(source);
    expect(next).toContain('padding');
    expect(next).toContain('color: "blue"');
  });

  it('persists e2e-style createElement button with existing inline style (P2-12 happy path)', () => {
    // Mirrors e2e/specs/tools-overlay.spec.ts TWEAKS_AWARE_APP_JSX shape.
    const source =
      'function App() {\n' +
      '  return React.createElement("button", {\n' +
      '    "data-testid": "app-btn",\n' +
      '    id: "app-btn",\n' +
      '    style: { padding: "8px 16px", marginTop: "12px" },\n' +
      '  }, "Hover me");\n' +
      '}';
    const snippet =
      '<button data-testid="app-btn" id="app-btn" style="padding: 8px 16px; margin-top: 12px;">Hover me</button>';
    const next = applyInlineStyleToSource(source, 'App.jsx', snippet, {
      'background-color': '#141413',
    });
    expect(next).not.toBe(source);
    // Existing styles preserved
    expect(next).toMatch(/padding/);
    expect(next).toMatch(/marginTop/);
    // New style merged
    expect(next).toMatch(/backgroundColor:\s*"#141413"/);
  });

  it('returns source unchanged when no JSX/createElement in source matches tag+class', () => {
    const source = 'export default () => <span className="other">x</span>;';
    const snippet = '<button class="primary">Click</button>';
    const next = applyInlineStyleToSource(source, 'App.jsx', snippet, { color: 'red' });
    expect(next).toBe(source);
  });
});

describe('findSourceMatch (shared util)', () => {
  it('returns a hit for literal JSX with matching tag + class', () => {
    const source = '<div className="x y">hi</div>';
    const hit = findSourceMatch(source, '<div class="x y">hi</div>');
    expect(hit).not.toBeNull();
    expect(hit!.tag).toBe('div');
  });

  it('returns a hit for createElement with matching tag + class', () => {
    const source = 'React.createElement("button", { className: "primary" }, "Click");';
    const hit = findSourceMatch(source, '<button class="primary">Click</button>');
    expect(hit).not.toBeNull();
    expect(hit!.tag).toBe('button');
  });

  it('null when tag does not occur in source at all', () => {
    const source = 'const x = 1;';
    const hit = findSourceMatch(source, '<button class="primary">Click</button>');
    expect(hit).toBeNull();
  });

  it('finds the tightest match by class intersection — element with all the snippet classes wins', () => {
    // Two buttons; first has only one of the two snippet classes, second has both.
    const source =
      'export default () => (\n' +
      '  <div>\n' +
      '    <button className="primary">A</button>\n' +
      '    <button className="primary cta">B</button>\n' +
      '  </div>\n' +
      ');';
    const hit = findSourceMatch(source, '<button class="primary cta">B</button>');
    expect(hit).not.toBeNull();
    // Should match the second button (more class overlap)
    expect(hit!.outerHTMLAnchor).toContain('primary cta');
  });
});

describe('mergePendingEdit', () => {
  it('creates new entry on first call', () => {
    const map = new Map();
    const next = mergePendingEdit(map, 'sel-1', '<div>x</div>', 'color', 'red');
    expect(next.size).toBe(1);
    expect(next.get('sel-1')).toEqual({
      selector: 'sel-1',
      outerHTMLSnippet: '<div>x</div>',
      styles: { color: 'red' },
    });
  });

  it('accumulates multiple props on same selector', () => {
    let map = new Map();
    map = mergePendingEdit(map, 'sel-1', '<div>x</div>', 'color', 'red');
    map = mergePendingEdit(map, 'sel-1', '<div>x</div>', 'font-size', '14px');
    expect(map.get('sel-1')!.styles).toEqual({ color: 'red', 'font-size': '14px' });
  });

  it('overrides same-named prop on same selector', () => {
    let map = new Map();
    map = mergePendingEdit(map, 'sel-1', '<div>x</div>', 'color', 'red');
    map = mergePendingEdit(map, 'sel-1', '<div>x</div>', 'color', 'blue');
    expect(map.get('sel-1')!.styles).toEqual({ color: 'blue' });
  });

  it('keeps separate entries for different selectors', () => {
    let map = new Map();
    map = mergePendingEdit(map, 'sel-1', '<a>1</a>', 'color', 'red');
    map = mergePendingEdit(map, 'sel-2', '<b>2</b>', 'color', 'blue');
    expect(map.size).toBe(2);
  });
});
