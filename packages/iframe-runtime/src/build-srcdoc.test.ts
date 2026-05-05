// Tests for buildSrcdoc + close-script escaping + multi-file bundling.
//
// 这些测试守护几个 clone-fidelity-critical 不变量：
//   - close-script 字面量（`</script>`）必须被转义，否则 iframe HTML 会被破坏
//   - React / ReactDOM / Babel 的 CDN 版本号锁死（18.3.1 / 7.29.0）
//   - 多文件依赖排序按 themes/data → primitives → ios-frame → screen-* → app.jsx (EDITMODE)
//   - 没有 createRoot.render 调用时自动追加 entry

import { describe, expect, it } from 'vitest';
import {
  buildSrcdoc,
  escapeForScript,
  findEditmodeFile,
  hasEntryCall,
  isInlineableTextFile,
  REACT_GLOBALS_PRELUDE,
  sortFilesForExecution,
  stripModuleSyntax,
} from './build-srcdoc';

const oneFileBundle = [
  {
    path: 'app.jsx',
    mimeType: 'text/babel',
    content:
      'const T = /*EDITMODE-BEGIN*/{ "primary": "#c96442" }/*EDITMODE-END*/;\n' +
      'function App() { return <div>hi</div>; }\n' +
      "ReactDOM.createRoot(document.getElementById('root')).render(<App/>);",
  },
];

describe('escapeForScript', () => {
  it('escapes literal close-script tags', () => {
    const input = 'const a = "</script>";';
    const out = escapeForScript(input);
    expect(out).not.toContain('</script>');
    expect(out).toContain('<\\/script>');
  });

  it('passes through code without close-script literals', () => {
    const code = "const x = '<' + 'script>';";
    expect(escapeForScript(code)).toBe(code);
  });
});

describe('hasEntryCall', () => {
  it('detects ReactDOM.createRoot(...).render(...) call', () => {
    expect(hasEntryCall(oneFileBundle)).toBe(true);
  });

  it('returns false when no createRoot.render present', () => {
    expect(
      hasEntryCall([{ path: 'a.jsx', mimeType: 'text/babel', content: 'function App(){}' }]),
    ).toBe(false);
  });
});

describe('findEditmodeFile', () => {
  it('returns path of file with EDITMODE marker', () => {
    expect(findEditmodeFile(oneFileBundle)).toBe('app.jsx');
  });

  it('returns null when no file has EDITMODE marker', () => {
    expect(
      findEditmodeFile([
        { path: 'plain.jsx', mimeType: 'text/babel', content: 'function App(){}' },
      ]),
    ).toBeNull();
  });
});

describe('sortFilesForExecution', () => {
  it('orders files by convention: themes/data → primitives → ios-frame → screen-* → app(editmode)', () => {
    const files = [
      { path: 'app.jsx', mimeType: 'text/babel', content: '/*EDITMODE-BEGIN*/{}/*EDITMODE-END*/' },
      { path: 'screen-home.jsx', mimeType: 'text/babel', content: '' },
      { path: 'primitives.jsx', mimeType: 'text/babel', content: '' },
      { path: 'screen-about.jsx', mimeType: 'text/babel', content: '' },
      { path: 'data.jsx', mimeType: 'text/babel', content: '' },
      { path: 'ios-frame.jsx', mimeType: 'text/babel', content: '' },
    ];
    const sorted = sortFilesForExecution(files, 'app.jsx');
    expect(sorted.map((f) => f.path)).toEqual([
      'data.jsx',
      'primitives.jsx',
      'ios-frame.jsx',
      'screen-about.jsx',
      'screen-home.jsx',
      'app.jsx',
    ]);
  });
});

describe('buildSrcdoc', () => {
  it('produces full HTML with React 18.3.1 / Babel 7.29.0 CDN script tags', () => {
    const html = buildSrcdoc(oneFileBundle);
    expect(html).toContain('react@18.3.1');
    expect(html).toContain('react-dom@18.3.1');
    expect(html).toContain('@babel/standalone@7.29.0');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<div id="root"></div>');
  });

  it('escapes close-script tag inside agent code (regression: outer script must not close early)', () => {
    const malicious = [
      {
        path: 'evil.jsx',
        mimeType: 'text/babel',
        content: 'const html = "</script><script>alert(1)<\\/script>";',
      },
    ];
    const html = buildSrcdoc(malicious);
    // Agent script 内的 `</script>` 字面量必须被转义成 `<\/script>`，否则 iframe HTML
    // parser 会在 inline script 内容里看到 `</script>` 时提前关闭外层 `<script>` 标签。
    // 我们在 AGENT_BODY 区段内做这个断言。
    const agentBody = html.match(/<!-- AGENT_BODY_BEGIN -->[\s\S]*?<!-- AGENT_BODY_END -->/);
    expect(agentBody).not.toBeNull();
    // agent body 内不应有未转义的字面 `</script>`（除了 AGENT_BODY 自身的关闭 tag）
    const agentBodyText = agentBody![0];
    // 用户内容里的 `</script>` 必须转义为 `<\/script>`
    expect(agentBodyText).toContain('<\\/script>');
    // 结构上，srcdoc 整体必须有真实的 `</script>` closing tags（让浏览器能 parse）
    expect(html).toMatch(/<\/script>/);
  });

  it('injects auto-entry render call when bundle lacks createRoot.render', () => {
    const html = buildSrcdoc([
      {
        path: 'no-entry.jsx',
        mimeType: 'text/babel',
        content: 'function App(){ return <div/>; }',
      },
    ]);
    expect(html).toContain('// ===== auto-entry =====');
    expect(html).toContain("ReactDOM.createRoot(document.getElementById('root')).render(<App/>);");
  });

  it('does not inject auto-entry when bundle already has createRoot.render', () => {
    const html = buildSrcdoc(oneFileBundle);
    expect(html).not.toContain('// ===== auto-entry =====');
  });

  it('embeds tweaks setup + listener + originalScript when injectTweaks is true (default)', () => {
    const html = buildSrcdoc(oneFileBundle);
    expect(html).toContain('window.__codesign_tweaks__');
    expect(html).toContain('originalScript=');
    expect(html).toContain('codesign:tweaks:update');
  });

  it('embeds overlay script when injectOverlay is true (default)', () => {
    const html = buildSrcdoc(oneFileBundle);
    expect(html).toContain('OVERLAY_READY');
    expect(html).toContain('SET_MODE');
    expect(html).toContain('EDIT_STYLE');
  });

  it('omits tweaks bridge when injectTweaks=false', () => {
    const html = buildSrcdoc(oneFileBundle, { injectTweaks: false });
    expect(html).not.toContain('window.__codesign_tweaks__');
    expect(html).not.toContain('codesign:tweaks:update');
  });

  it('omits overlay when injectOverlay=false', () => {
    const html = buildSrcdoc(oneFileBundle, { injectOverlay: false });
    expect(html).not.toContain('OVERLAY_READY');
  });

  it('honors integrity hashes when provided', () => {
    const html = buildSrcdoc(oneFileBundle, {
      integrityHashes: {
        react: 'sha384-react',
        reactDom: 'sha384-rdom',
        babel: 'sha384-babel',
      },
    });
    expect(html).toContain('integrity="sha384-react"');
    expect(html).toContain('integrity="sha384-rdom"');
    expect(html).toContain('integrity="sha384-babel"');
    expect(html).toContain('crossorigin="anonymous"');
  });

  it('respects custom CDN bases', () => {
    const html = buildSrcdoc(oneFileBundle, {
      reactCdn: 'https://cdn.example.com',
      babelCdn: 'https://cdn.example.com',
    });
    expect(html).toContain('https://cdn.example.com/react@18.3.1');
    expect(html).toContain('https://cdn.example.com/@babel/standalone@7.29.0');
    expect(html).not.toContain('https://unpkg.com');
  });

  it('orders multi-file bundle correctly (themes/data → primitives → screen-* → app)', () => {
    const files = [
      {
        path: 'app.jsx',
        mimeType: 'text/babel',
        content:
          'const T = /*EDITMODE-BEGIN*/{}/*EDITMODE-END*/;\nfunction App(){ return <div/>; }',
      },
      { path: 'screen-home.jsx', mimeType: 'text/babel', content: 'function Home(){}' },
      { path: 'primitives.jsx', mimeType: 'text/babel', content: 'function Btn(){}' },
      { path: 'data.jsx', mimeType: 'text/babel', content: 'const data = {};' },
    ];
    const html = buildSrcdoc(files);
    const dataIdx = html.indexOf('// ===== data.jsx =====');
    const primIdx = html.indexOf('// ===== primitives.jsx =====');
    const screenIdx = html.indexOf('// ===== screen-home.jsx =====');
    const appIdx = html.indexOf('// ===== app.jsx =====');
    expect(dataIdx).toBeGreaterThan(0);
    expect(primIdx).toBeGreaterThan(dataIdx);
    expect(screenIdx).toBeGreaterThan(primIdx);
    expect(appIdx).toBeGreaterThan(screenIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stripModuleSyntax — defensive ES-module statement stripping (E2E regression)
// ─────────────────────────────────────────────────────────────────────────────

describe('stripModuleSyntax', () => {
  it('strips named + default react imports', () => {
    expect(stripModuleSyntax("import React, { useState } from 'react';\n")).toBe('');
    expect(stripModuleSyntax("import React from 'react';\n")).toBe('');
    expect(stripModuleSyntax("import { useState, useEffect } from 'react';\n")).toBe('');
  });

  it('strips imports with double-quoted module paths', () => {
    expect(stripModuleSyntax('import { foo } from "lodash";\n')).toBe('');
  });

  it('strips multi-line named imports', () => {
    const src = "import {\n  useState,\n  useEffect,\n  useRef,\n} from 'react';\n";
    expect(stripModuleSyntax(src)).toBe('');
  });

  it('strips side-effect imports', () => {
    expect(stripModuleSyntax("import './styles.css';\n")).toBe('');
  });

  it('rewrites `export default function App(...)` to `function App(...)` (preserves name)', () => {
    expect(stripModuleSyntax('export default function App() { return null; }')).toBe(
      'function App() { return null; }',
    );
  });

  it('drops `export default` keyword for anonymous expressions', () => {
    expect(stripModuleSyntax('export default <App/>;')).toBe('<App/>;');
  });

  it('rewrites `export const X = ...` to `const X = ...`', () => {
    expect(stripModuleSyntax('export const Theme = { color: "red" };')).toBe(
      'const Theme = { color: "red" };',
    );
  });

  it('rewrites `export function X` to `function X`', () => {
    expect(stripModuleSyntax('export function helper() { return 1; }')).toBe(
      'function helper() { return 1; }',
    );
  });

  it('strips standalone `export { X };` lines', () => {
    expect(stripModuleSyntax('export { App, Theme };\n')).toBe('');
  });

  it('preserves non-module code untouched', () => {
    const src = 'function App() { return <div>Hello</div>; }\n';
    expect(stripModuleSyntax(src)).toBe(src);
  });

  it('handles a realistic agent-output counter (E2E regression)', () => {
    const src = [
      "import React, { useState } from 'react';",
      '',
      'export default function App() {',
      '  const [count, setCount] = useState(0);',
      '  return <button onClick={() => setCount(count + 1)}>{count}</button>;',
      '}',
    ].join('\n');
    const out = stripModuleSyntax(src);
    expect(out).not.toContain('import');
    expect(out).not.toContain('export');
    expect(out).toContain('function App()');
    expect(out).toContain('useState(0)');
  });
});

describe('buildSrcdoc — REACT_GLOBALS_PRELUDE injection', () => {
  it('injects React-globals (via globalThis property assignment) before the agent script', () => {
    const html = buildSrcdoc([
      { path: 'App.jsx', mimeType: 'text/babel', content: 'function App(){ return <div/>; }' },
    ]);
    expect(html).toContain('React globals prelude');
    expect(html).toContain('Object.assign(globalThis');
    expect(html).toContain('useState: React.useState');
    expect(html).toContain('Fragment: React.Fragment');
    const preludeIdx = html.indexOf('React globals prelude');
    const appIdx = html.indexOf('// ===== App.jsx =====');
    expect(preludeIdx).toBeLessThan(appIdx);
  });

  it('strips agent imports from a realistic counter example end-to-end', () => {
    const html = buildSrcdoc([
      {
        path: 'App.jsx',
        mimeType: 'text/babel',
        content:
          "import React, { useState } from 'react';\n\nexport default function App() {\n  const [n] = useState(0);\n  return <div>{n}</div>;\n}",
      },
    ]);
    const agentBodyStart = html.indexOf('// ===== App.jsx =====');
    const agentBodyEnd = html.indexOf('<!-- AGENT_BODY_END -->');
    const agentBody = html.slice(agentBodyStart, agentBodyEnd);
    expect(agentBody).not.toContain('import React');
    expect(agentBody).not.toContain("from 'react'");
    expect(agentBody).toContain('function App()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Binary file filtering — image / audio / video bytes must NOT reach the
// inline `<script type="text/babel">` body, otherwise Babel parses the raw
// bytes as JSX and the entire bundle aborts with
//   "Inline Babel script: Unexpected character '\xEF'"
// (regression: paste-image-into-chat materializes uploads/<name>.png in the
// project file tree → PreviewPanel re-fetches files → buildSrcdoc concatenates
// the PNG body into the agent script → preview crashes).
// ─────────────────────────────────────────────────────────────────────────────

describe('isInlineableTextFile', () => {
  it('keeps text/* mime types', () => {
    expect(isInlineableTextFile({ path: 'a.jsx', mimeType: 'text/jsx', content: '' })).toBe(true);
    expect(isInlineableTextFile({ path: 'a.css', mimeType: 'text/css', content: '' })).toBe(true);
    expect(isInlineableTextFile({ path: 'a.html', mimeType: 'text/html', content: '' })).toBe(true);
    expect(isInlineableTextFile({ path: 'a.js', mimeType: 'text/javascript', content: '' })).toBe(
      true,
    );
    expect(isInlineableTextFile({ path: 'a.txt', mimeType: 'text/plain', content: '' })).toBe(true);
  });

  it('keeps application/json', () => {
    expect(
      isInlineableTextFile({ path: 'tokens.json', mimeType: 'application/json', content: '{}' }),
    ).toBe(true);
  });

  it('rejects image/* mime types', () => {
    expect(isInlineableTextFile({ path: 'x.png', mimeType: 'image/png', content: '' })).toBe(false);
    expect(isInlineableTextFile({ path: 'x.jpg', mimeType: 'image/jpeg', content: '' })).toBe(
      false,
    );
    expect(isInlineableTextFile({ path: 'x.svg', mimeType: 'image/svg+xml', content: '' })).toBe(
      false,
    );
  });

  it('rejects audio / video mime types', () => {
    expect(
      isInlineableTextFile({ path: 'x.mp3', mimeType: 'audio/mpeg' as 'text/plain', content: '' }),
    ).toBe(false);
    expect(
      isInlineableTextFile({ path: 'x.mp4', mimeType: 'video/mp4' as 'text/plain', content: '' }),
    ).toBe(false);
  });

  it('rejects application/octet-stream', () => {
    expect(
      isInlineableTextFile({
        path: 'blob.bin',
        mimeType: 'application/octet-stream' as 'text/plain',
        content: '',
      }),
    ).toBe(false);
  });

  it('falls back to extension when mimeType is missing or unknown', () => {
    // Empty / unknown mime → use extension.
    expect(
      isInlineableTextFile({ path: 'x.png', mimeType: '' as 'text/plain', content: '' }),
    ).toBe(false);
    expect(
      isInlineableTextFile({ path: 'x.woff2', mimeType: '' as 'text/plain', content: '' }),
    ).toBe(false);
    expect(
      isInlineableTextFile({ path: 'x.unknownext', mimeType: '' as 'text/plain', content: '' }),
    ).toBe(true);
  });
});

describe('buildSrcdoc — binary file filtering', () => {
  it('does NOT inline image bytes into the agent script body', () => {
    // Simulate a PNG `uploads/tinytest.png` materialized into the file tree
    // by the paste-image-into-chat feature. The "content" here stands in for
    // the raw PNG bytes that were UTF-8-decoded into a JS string before
    // hitting buildSrcdoc — the literal `\xEF\xBF\xBD` replacement char that
    // crashed Babel in the bug report.
    const html = buildSrcdoc([
      {
        path: 'App.jsx',
        mimeType: 'text/jsx',
        content: 'function App(){ return <div/>; }',
      },
      {
        path: 'uploads/tinytest.png',
        mimeType: 'image/png',
        content: '�PNG\r\n\x1a\nbinary-bytes-pretend',
      },
    ]);

    // Image file separator must be absent.
    expect(html).not.toContain('// ===== uploads/tinytest.png =====');
    // The literal "PNG" magic header (which Babel would choke on) must not
    // appear inside the agent body. Match against the AGENT_BODY_BEGIN slice
    // so we don't accidentally match elsewhere (e.g. CDN URLs).
    const agentBody = html.match(/<!-- AGENT_BODY_BEGIN -->[\s\S]*?<!-- AGENT_BODY_END -->/);
    expect(agentBody).not.toBeNull();
    expect(agentBody![0]).not.toContain('binary-bytes-pretend');

    // Text file is still present.
    expect(html).toContain('// ===== App.jsx =====');
    expect(html).toContain('function App(){ return <div/>; }');
  });

  it('filters out audio / video / octet-stream too', () => {
    const html = buildSrcdoc([
      { path: 'App.jsx', mimeType: 'text/jsx', content: 'function App(){}' },
      {
        path: 'sound.mp3',
        mimeType: 'audio/mpeg' as 'text/plain',
        content: 'AUDIO_RAW_BYTES_SHOULD_NOT_INLINE',
      },
      {
        path: 'clip.mp4',
        mimeType: 'video/mp4' as 'text/plain',
        content: 'VIDEO_RAW_BYTES_SHOULD_NOT_INLINE',
      },
      {
        path: 'blob.bin',
        mimeType: 'application/octet-stream' as 'text/plain',
        content: 'OCTET_RAW_BYTES_SHOULD_NOT_INLINE',
      },
    ]);
    expect(html).not.toContain('AUDIO_RAW_BYTES_SHOULD_NOT_INLINE');
    expect(html).not.toContain('VIDEO_RAW_BYTES_SHOULD_NOT_INLINE');
    expect(html).not.toContain('OCTET_RAW_BYTES_SHOULD_NOT_INLINE');
    expect(html).not.toContain('// ===== sound.mp3 =====');
    expect(html).not.toContain('// ===== clip.mp4 =====');
    expect(html).not.toContain('// ===== blob.bin =====');
    // jsx still inlined
    expect(html).toContain('// ===== App.jsx =====');
  });

  it('uses extension fallback when mimeType is empty', () => {
    // mimeType empty (legacy file or untyped upload) — extension still tells
    // us it's binary, so we must NOT inline the raw bytes.
    const html = buildSrcdoc([
      { path: 'App.jsx', mimeType: 'text/jsx', content: 'function App(){}' },
      {
        path: 'mystery.woff2',
        mimeType: '' as 'text/plain',
        content: 'FONT_RAW_BYTES_SHOULD_NOT_INLINE',
      },
    ]);
    expect(html).not.toContain('FONT_RAW_BYTES_SHOULD_NOT_INLINE');
    expect(html).not.toContain('// ===== mystery.woff2 =====');
  });

  it('keeps inlining text files alongside binary siblings (bug repro shape)', () => {
    // The exact shape from the bug report: an App.jsx + an uploads/png. The
    // preview must still build cleanly, and the auto-entry must still fire
    // because the only text file lacks createRoot.render.
    const html = buildSrcdoc([
      {
        path: 'App.jsx',
        mimeType: 'text/jsx',
        content: 'function App(){ return <div>hi</div>; }',
      },
      {
        path: 'uploads/tinytest.png',
        mimeType: 'image/png',
        content: '�PNG\r\n\x1a\n',
      },
    ]);
    expect(html).toContain('// ===== App.jsx =====');
    expect(html).toContain('// ===== auto-entry =====');
    expect(html).toContain("ReactDOM.createRoot(document.getElementById('root')).render(<App/>);");
  });
});

describe('REACT_GLOBALS_PRELUDE — must coexist with files that re-destructure React hooks', () => {
  // Generated artifacts often declare
  //   `const { useState, useEffect, useMemo, useRef } = React;`
  // at the top of a script. Under classic-script semantics, multiple
  // <script> tags share the *script's lexical environment* (per HTML spec),
  // so a prelude that introduces a lexical binding for `useState` (whether
  // const/let/var) collides with the file's own `const useState` and triggers
  //   "SyntaxError: Identifier 'useState' has already been declared"
  // at parse time. The same collision also fires in the jsx-only path, where
  // prelude + files are concatenated into a single <script> body.
  // → Prelude MUST therefore avoid lexical declarations entirely; only
  // property assignment on the global object is safe.

  it('parses cleanly when followed by top-level `const { useState, ... } = React;`', () => {
    const reDestructureHeader =
      'const { useState, useEffect, useMemo, useRef } = React;\nfunction Kicker() { return useState(0); }';
    // Function constructor is parse-only (we never call it). If the prelude
    // and the snippet collide on a lexical binding, parse throws here.
    expect(() => new Function('React', `${REACT_GLOBALS_PRELUDE}\n${reDestructureHeader}`)).not.toThrow();
  });

  it('does not introduce any lexical const/let/var binding for hook identifiers', () => {
    // Belt-and-suspenders: assert at the source-text level that no lexical
    // declaration form precedes a hook identifier in the prelude.
    expect(REACT_GLOBALS_PRELUDE).not.toMatch(/\b(?:const|let|var)\s*\{[^}]*useState/);
    expect(REACT_GLOBALS_PRELUDE).not.toMatch(/\b(?:const|let|var)\s+useState\b/);
  });
});
