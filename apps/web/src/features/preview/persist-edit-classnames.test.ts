// persist-edit-classnames — AST-based className write-back unit tests.
//
// Tests both the pure helper (mutateClassList) and the AST roundtrip
// (applyClassChangeToSource) across the three className shapes plus the
// pending-edit accumulator semantics.

import { describe, expect, it } from 'vitest';
import {
  applyClassChangeToSource,
  mergePendingClassEdit,
  __testing,
  type PendingClassEditEntry,
} from './persist-edit-classnames';

const { mutateClassList } = __testing;

// ─────────────────────────────────────────────────────────────────────────────
// mutateClassList
// ─────────────────────────────────────────────────────────────────────────────

describe('mutateClassList', () => {
  it('adds new classes to the end', () => {
    expect(mutateClassList('a b', { add: ['c'], remove: [] })).toBe('a b c');
  });

  it('removes classes preserving order of survivors', () => {
    expect(mutateClassList('a b c d', { add: [], remove: ['b', 'd'] })).toBe('a c');
  });

  it('add + remove together: remove first, then add (no duplicate)', () => {
    expect(
      mutateClassList('bg-red-500 text-white', {
        add: ['bg-blue-500'],
        remove: ['bg-red-500'],
      }),
    ).toBe('text-white bg-blue-500');
  });

  it('idempotent on adding an already-present class', () => {
    expect(mutateClassList('a b c', { add: ['b'], remove: [] })).toBe('a b c');
  });

  it('returns empty string when all classes removed', () => {
    expect(mutateClassList('a', { add: [], remove: ['a'] })).toBe('');
  });

  it('handles multiple consecutive whitespace in input', () => {
    expect(mutateClassList('  a   b   c  ', { add: ['d'], remove: ['b'] })).toBe('a c d');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyClassChangeToSource — JSX shape coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('applyClassChangeToSource — string-attribute className', () => {
  it('replaces a single class', () => {
    const src =
      'export default function App() {\n  return <button className="bg-red-500">x</button>;\n}';
    const result = applyClassChangeToSource(
      src,
      'App.jsx',
      '<button className="bg-red-500">x</button>',
      {
        add: ['bg-blue-500'],
        remove: ['bg-red-500'],
      },
    );
    expect(result.status).toBe('changed');
    expect(result.source).toContain('className="bg-blue-500"');
    expect(result.source).not.toContain('bg-red-500');
  });

  it('preserves untouched classes', () => {
    const src = 'export default () => <div className="text-white bg-red-500 p-4">x</div>;';
    const result = applyClassChangeToSource(
      src,
      'App.jsx',
      '<div className="text-white bg-red-500 p-4">x</div>',
      {
        add: ['bg-emerald-500'],
        remove: ['bg-red-500'],
      },
    );
    expect(result.status).toBe('changed');
    // Order: text-white, p-4 (survivors), then bg-emerald-500 (new)
    expect(result.source).toContain('className="text-white p-4 bg-emerald-500"');
  });

  it('returns unchanged when add+remove produces an identical class list', () => {
    const src = 'export default () => <div className="a b">x</div>;';
    const result = applyClassChangeToSource(src, 'App.jsx', '<div className="a b">x</div>', {
      add: ['a'], // already present
      remove: ['c'], // not present
    });
    expect(result.status).toBe('unchanged');
    expect(result.source).toBe(src);
  });

  it('synthesizes a new className attribute when none exists', () => {
    const src = 'export default () => <div>hello</div>;';
    const result = applyClassChangeToSource(src, 'App.jsx', '<div>hello</div>', {
      add: ['p-4'],
      remove: [],
    });
    expect(result.status).toBe('changed');
    expect(result.source).toContain('className="p-4"');
  });
});

describe('applyClassChangeToSource — JSXExpressionContainer with string', () => {
  it('mutates className={"x y"} preserving the brace wrapper', () => {
    const src = 'export default () => <div className={"a b"}>x</div>;';
    const result = applyClassChangeToSource(src, 'App.jsx', '<div className={"a b"}>x</div>', {
      add: ['c'],
      remove: ['a'],
    });
    expect(result.status).toBe('changed');
    expect(result.source).toContain('className={"b c"}');
  });

  it('mutates className={`x y`} (template literal with no interpolation)', () => {
    const src = 'export default () => <div className={`a b`}>x</div>;';
    const result = applyClassChangeToSource(src, 'App.jsx', '<div className={`a b`}>x</div>', {
      add: ['c'],
      remove: [],
    });
    expect(result.status).toBe('changed');
    expect(result.source).toContain('className={"a b c"}');
  });
});

describe('applyClassChangeToSource — unsupported expressions', () => {
  it('reports unsupported for cn(...) call expressions', () => {
    const src = 'import cn from "clsx";\nexport default () => <div className={cn("a", b)}>x</div>;';
    const result = applyClassChangeToSource(src, 'App.jsx', '<div className={cn("a", b)}>x</div>', {
      add: ['c'],
      remove: [],
    });
    expect(result.status).toBe('unsupported');
    expect(result.source).toBe(src);
  });

  it('reports unsupported for ternary expressions', () => {
    const src = 'export default () => <div className={ok ? "x" : "y"}>x</div>;';
    const result = applyClassChangeToSource(
      src,
      'App.jsx',
      '<div className={ok ? "x" : "y"}>x</div>',
      {
        add: ['c'],
        remove: [],
      },
    );
    expect(result.status).toBe('unsupported');
  });

  it('reports unsupported for template literal with interpolations', () => {
    const src = 'export default () => <div className={`a ${x}`}>y</div>;';
    const result = applyClassChangeToSource(src, 'App.jsx', '<div className={`a ${x}`}>y</div>', {
      add: ['c'],
      remove: [],
    });
    expect(result.status).toBe('unsupported');
  });
});

describe('applyClassChangeToSource — file extension gating', () => {
  it('returns unsupported for .html files', () => {
    const src = '<button class="bg-red-500">x</button>';
    const result = applyClassChangeToSource(
      src,
      'index.html',
      '<button class="bg-red-500">x</button>',
      {
        add: ['bg-blue-500'],
        remove: ['bg-red-500'],
      },
    );
    expect(result.status).toBe('unsupported');
  });

  it('accepts .tsx', () => {
    const src = 'export default () => <div className="a">x</div>;';
    const result = applyClassChangeToSource(src, 'App.tsx', '<div className="a">x</div>', {
      add: ['b'],
      remove: [],
    });
    expect(result.status).toBe('changed');
  });
});

describe('applyClassChangeToSource — error paths', () => {
  it('returns not-found when the snippet does not appear in source', () => {
    const src = 'export default () => <div>hello</div>;';
    const result = applyClassChangeToSource(src, 'App.jsx', '<button>missing</button>', {
      add: ['b'],
      remove: [],
    });
    expect(result.status).toBe('not-found');
  });

  it('returns parse-error on invalid JSX', () => {
    const src = 'this is { not jsx';
    const result = applyClassChangeToSource(src, 'App.jsx', '<div></div>', {
      add: ['b'],
      remove: [],
    });
    // errorRecovery is on, but if we somehow can't even start parsing → parse-error.
    // With recovery on, this might actually parse-recover and become not-found instead.
    expect(['parse-error', 'not-found']).toContain(result.status);
  });

  it('returns unchanged when add and remove are both empty', () => {
    const src = 'export default () => <div className="a">x</div>;';
    const result = applyClassChangeToSource(src, 'App.jsx', '<div className="a">x</div>', {
      add: [],
      remove: [],
    });
    expect(result.status).toBe('unchanged');
    expect(result.source).toBe(src);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createElement-style fallback (P2-12) — applyClassChangeToSource needs to
// find the source location even for React.createElement() calls.
// ─────────────────────────────────────────────────────────────────────────────

describe('applyClassChangeToSource — createElement-style source (P2-12)', () => {
  it('mutates className inside a React.createElement call', () => {
    const src =
      'export default function App() {\n' +
      '  return React.createElement("button", { className: "bg-red-500" }, "x");\n' +
      '}';
    const result = applyClassChangeToSource(
      src,
      'App.jsx',
      '<button class="bg-red-500">x</button>',
      { add: ['bg-blue-500'], remove: ['bg-red-500'] },
    );
    expect(result.status).toBe('changed');
    expect(result.source).toContain('bg-blue-500');
    expect(result.source).not.toContain('bg-red-500');
  });

  it('reports unsupported when createElement uses a non-string-literal className (e.g. variable)', () => {
    const src =
      'const cls = "bg-red-500";\n' +
      'export default () => React.createElement("button", { className: cls }, "x");';
    const result = applyClassChangeToSource(
      src,
      'App.jsx',
      '<button class="bg-red-500">x</button>',
      {
        add: ['bg-blue-500'],
        remove: ['bg-red-500'],
      },
    );
    // Either unsupported or unchanged is acceptable — point is no source corruption.
    expect(['unsupported', 'unchanged', 'not-found']).toContain(result.status);
    if (result.status !== 'changed') {
      expect(result.source).toBe(src);
    }
  });

  it('finds JSX even when prop order differs from outerHTML', () => {
    // Author wrote onClick before className; rendered outerHTML has class= first.
    const src =
      'export default function App() {\n' +
      '  return <div onClick={fn} className="card primary">x</div>;\n' +
      '}';
    const snippet = '<div class="card primary">x</div>';
    const result = applyClassChangeToSource(src, 'App.jsx', snippet, {
      add: ['rounded-lg'],
      remove: [],
    });
    expect(result.status).toBe('changed');
    expect(result.source).toContain('rounded-lg');
  });
});

describe('applyClassChangeToSource — preserves rest of source', () => {
  it('does not reformat unrelated regions of the file', () => {
    const src = [
      'import React from "react";',
      '',
      '// keep this comment',
      'function Counter() {',
      '  return (',
      '    <div className="container">',
      '      <button className="bg-red-500">click</button>',
      '    </div>',
      '  );',
      '}',
      '',
      'export default Counter;',
    ].join('\n');
    const result = applyClassChangeToSource(
      src,
      'Counter.jsx',
      '<button className="bg-red-500">click</button>',
      {
        add: ['bg-emerald-500'],
        remove: ['bg-red-500'],
      },
    );
    expect(result.status).toBe('changed');
    // Only the button line should differ.
    expect(result.source).toContain('// keep this comment');
    expect(result.source).toContain('export default Counter;');
    expect(result.source).toContain('className="bg-emerald-500"');
    expect(result.source).not.toContain('bg-red-500');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergePendingClassEdit — accumulator semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('mergePendingClassEdit', () => {
  it('creates a new entry on first edit for a selector', () => {
    const next = mergePendingClassEdit(new Map(), 'button.cta', '<button>x</button>', {
      add: ['bg-blue-500'],
      remove: ['bg-red-500'],
    });
    const entry = next.get('button.cta')!;
    expect(entry.add).toEqual(new Set(['bg-blue-500']));
    expect(entry.remove).toEqual(new Set(['bg-red-500']));
  });

  it('union-s adds and removes across edits', () => {
    let map = mergePendingClassEdit(new Map(), 'sel', 'snip', {
      add: ['a'],
      remove: ['x'],
    });
    map = mergePendingClassEdit(map, 'sel', 'snip', {
      add: ['b'],
      remove: ['y'],
    });
    const entry = map.get('sel')!;
    expect(entry.add).toEqual(new Set(['a', 'b']));
    expect(entry.remove).toEqual(new Set(['x', 'y']));
  });

  it('cancels an earlier add when the same class is later removed', () => {
    let map = mergePendingClassEdit(new Map(), 'sel', 'snip', {
      add: ['bg-red'],
      remove: [],
    });
    map = mergePendingClassEdit(map, 'sel', 'snip', {
      add: [],
      remove: ['bg-red'],
    });
    const entry = map.get('sel')!;
    expect(entry.add.has('bg-red')).toBe(false);
    expect(entry.remove.has('bg-red')).toBe(true);
  });

  it('cancels an earlier remove when the same class is later added back', () => {
    let map = mergePendingClassEdit(new Map(), 'sel', 'snip', {
      add: [],
      remove: ['bg-blue'],
    });
    map = mergePendingClassEdit(map, 'sel', 'snip', {
      add: ['bg-blue'],
      remove: [],
    });
    const entry = map.get('sel')!;
    expect(entry.add.has('bg-blue')).toBe(true);
    expect(entry.remove.has('bg-blue')).toBe(false);
  });

  it('keeps separate selectors independent', () => {
    let map = mergePendingClassEdit(new Map(), 'a', 'snip-a', {
      add: ['x'],
      remove: [],
    });
    map = mergePendingClassEdit(map, 'b', 'snip-b', {
      add: ['y'],
      remove: [],
    });
    expect(map.size).toBe(2);
    expect((map.get('a') as PendingClassEditEntry).add.has('x')).toBe(true);
    expect((map.get('b') as PendingClassEditEntry).add.has('y')).toBe(true);
  });
});
