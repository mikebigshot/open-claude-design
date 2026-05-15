// build-srcdoc.ts — 把多文件 React JSX bundle 拼成完整的 iframe srcdoc HTML。
//
// 关键能力：多文件依赖排序启发式 + close-script 转义。
//
// React 18.3.1 + ReactDOM 18.3.1 + @babel/standalone 7.29.0 —— 版本号锁死。
// 改这些版本会让运行时和已有 artifact 行为分叉。

import { buildOverlayScript } from './overlay';
import { buildTweaksBridgeSetup, buildTweaksBridgeListener } from './tweaks-bridge';
import {
  buildInlineErrorHandlerScript,
  INLINE_ERROR_SOURCE_GLOBAL,
} from './inline-error-handler';

// ---------------------------------------------------------------------------
// 类型 + 默认配置
// ---------------------------------------------------------------------------

/**
 * 输入的单个项目文件。
 *
 * - `path`：相对路径（如 `app.jsx`、`themes/data.jsx`）。仅用于排序启发式 + 注释标记，
 *   不影响 `<script>` 实际语义（最终所有文件被合并成单 bundle，共享 scope）。
 * - `content`：源代码（.jsx / .js / 任何 babel-react preset 能处理的文本）。
 * - `mimeType`：保留字段，方便未来支持 .css / .json 等非 JSX 文件。
 *   当前实现把所有文件都当 JSX 处理（POC 行为）；非 JSX 文件请由调用方在合并前过滤。
 */
export interface BundleFile {
  readonly path: string;
  readonly content: string;
  readonly mimeType: string;
}

/**
 * `buildSrcdoc` 的可选项。
 */
export interface BuildSrcdocOptions {
  /**
   * React 18.3.1 UMD CDN 基址（不含路径，会自动拼 `react@<ver>/umd/react.development.js`）。
   * 默认 `https://unpkg.com`，clone-fidelity 要求最终走 unpkg。
   */
  readonly reactCdn?: string;
  /**
   * @babel/standalone 7.29.0 CDN 基址。默认 `https://unpkg.com`。
   */
  readonly babelCdn?: string;
  /**
   * 可选的 Subresource Integrity 校验值。
   *
   * 当三个 hash 都提供时，CDN script tag 会带 `integrity=...` + `crossorigin=anonymous`。
   * 缺省时不加（安全起见但 POC 也未带 hash —— 生产环境强烈推荐补上）。
   */
  readonly integrityHashes?: {
    readonly react: string;
    readonly reactDom: string;
    readonly babel: string;
  };
  /** 是否注入 OVERLAY_SCRIPT（comment / edit / OVERLAY_READY 等）。默认 `true`。 */
  readonly injectOverlay?: boolean;
  /** 是否注入 Tweaks bridge（cached root + listener）。默认 `true`。 */
  readonly injectTweaks?: boolean;
  /**
   * 是否注入 inline error handler（编译/运行时错误 → in-iframe placeholder）。
   *
   * 默认 `true`。当 inline `<script type="text/babel">` 抛出 SyntaxError 或 agent
   * 脚本同步 throw 时，handler 会渲染一个 `data-codesign-iframe-error` placeholder
   * 到 body 里（前提是 `#root` 仍为空 —— 运行时错误后不会覆盖已渲染的 React tree）。
   *
   * 这个 handler 跟 `overlay.ts` 的 IFRAME_ERROR postMessage 是互补关系：postMessage
   * 让 host 知道出事了，placeholder 让 user **在 iframe 内**就能看到出了什么事。
   */
  readonly injectInlineErrorHandler?: boolean;
}

// 锁死的版本号 + 路径。改这些就破坏复刻精度。
const REACT_VERSION = '18.3.1';
const BABEL_STANDALONE_VERSION = '7.29.0';
const REACT_DEV_PATH = `react@${REACT_VERSION}/umd/react.development.js`;
const REACT_DOM_DEV_PATH = `react-dom@${REACT_VERSION}/umd/react-dom.development.js`;
const BABEL_PATH = `@babel/standalone@${BABEL_STANDALONE_VERSION}/babel.min.js`;
const DEFAULT_CDN = 'https://unpkg.com';

const ENTRY_RENDER_CALL = "ReactDOM.createRoot(document.getElementById('root')).render(<App/>);";

// 检测是否已经有 `ReactDOM.createRoot(<expr>).render` 调用。
//
// `<expr>` 通常是 `document.getElementById('root')`，自带一层嵌套括号 —— 简单的
// `[^)]*` 会被内层 `)` 截断而漏匹配。`(?:[^()]|\([^()]*\))*` 允许 1 层嵌套（足够覆
// 盖大多数 entry 写法，包括 `createRoot(document.getElementById('root'))`）。
const HAS_ENTRY_RE = /ReactDOM\.createRoot\s*\((?:[^()]|\([^()]*\))*\)\s*\.render/;

// ---------------------------------------------------------------------------
// 公共 helper
// ---------------------------------------------------------------------------

/**
 * Strip ES module `import` / `export` statements from agent-written JSX source.
 *
 * The runtime concatenates every project file into a single
 * `<script type="text/babel">` body (Babel's `react` preset only handles JSX,
 * not modules), so any literal `import` / `export` line is a SyntaxError once
 * the iframe loads. Agents trained on standard React idioms reflexively write
 * `import React, { useState } from 'react'` and `export default function App()`.
 * We forgive that here by stripping those lines, then injecting
 * REACT_GLOBALS_PRELUDE so bare `useState(...)` etc. resolve via the React
 * globals exposed by the UMD bundle.
 *
 * What we strip:
 *   - `import X from 'pkg';`              → ''
 *   - `import { a, b } from 'pkg';`       → ''
 *   - `import 'pkg';`                     → ''  (side-effect imports)
 *   - `export default function App(...)`  → `function App(...)`  (keeps name → global)
 *   - `export default expr;`              → `expr;`
 *   - `export const X = ...;`             → `const X = ...;`
 *   - `export function X(...)`            → `function X(...)`
 *   - `export { X };`                     → ''
 */
export function stripModuleSyntax(source: string): string {
  let out = source;
  // Strip plain default + named imports (single-line). Captures up through
  // the closing `'` and optional `;`. Multi-line `import {\n a,\n b \n}` is
  // also handled because we use `[\s\S]*?` inside the braces alternative.
  out = out.replace(/^[\t ]*import\b[\s\S]*?from\s*['"][^'"]+['"]\s*;?[\t ]*\r?\n?/gm, '');
  // Side-effect imports: `import 'pkg';`
  out = out.replace(/^[\t ]*import\s*['"][^'"]+['"]\s*;?[\t ]*\r?\n?/gm, '');
  // `export default function Name(...)` → `function Name(...)` (preserves name).
  out = out.replace(/^([\t ]*)export\s+default\s+(function|class)\s+/gm, '$1$2 ');
  // `export default <expr>;` → `<expr>;` (anonymous default — drop keyword).
  out = out.replace(/^([\t ]*)export\s+default\s+/gm, '$1');
  // `export const|let|var|function|class X` → `const|let|... X`.
  out = out.replace(
    /^([\t ]*)export\s+(const|let|var|function|class|async\s+function)\s+/gm,
    '$1$2 ',
  );
  // Standalone `export { x, y };` lines.
  out = out.replace(/^[\t ]*export\s*\{[\s\S]*?\}\s*;?[\t ]*\r?\n?/gm, '');
  return out;
}

/**
 * React globals exposed before the agent script — covers the bare
 * `useState(...)` / `useEffect(...)` / `<Fragment>` / `forwardRef` etc.
 * patterns that follow naturally when the agent writes `import { X } from
 * 'react'` (which we just stripped). The UMD React bundle exposes everything
 * via `window.React`.
 *
 * **Why property assignment, not lexical destructure:** under classic-script
 * semantics, multiple <script> tags share the script-level lexical environment
 * (per HTML spec). Generated artifacts often declare
 * `const { useState, useEffect, useMemo, useRef } = React;` at the top of
 * their own script. A prelude that introduces a lexical binding
 * (`const`/`let`/`var`) for `useState` collides with the file's own
 * `const useState` and aborts at parse time with
 *   SyntaxError: Identifier 'useState' has already been declared
 * Property assignment on `globalThis` (= the iframe's window) sidesteps this:
 * it doesn't enter the lexical environment, so a follow-on file's
 * `const { useState } = React;` cleanly *shadows* the global property in its
 * own scope; files that don't re-destructure still resolve bare `useState`
 * via the standard global-object lookup.
 */
export const REACT_GLOBALS_PRELUDE = [
  'Object.assign(globalThis, {',
  '  useState: React.useState, useEffect: React.useEffect, useRef: React.useRef,',
  '  useMemo: React.useMemo, useCallback: React.useCallback,',
  '  useContext: React.useContext, useReducer: React.useReducer,',
  '  useLayoutEffect: React.useLayoutEffect,',
  '  useImperativeHandle: React.useImperativeHandle,',
  '  useTransition: React.useTransition, useDeferredValue: React.useDeferredValue,',
  '  useId: React.useId,',
  '  Fragment: React.Fragment, createContext: React.createContext,',
  '  forwardRef: React.forwardRef, memo: React.memo, lazy: React.lazy,',
  '  Suspense: React.Suspense, StrictMode: React.StrictMode,',
  '});',
].join('\n');

/**
 * Mime types whose contents are raw binary bytes — must NEVER be inlined into
 * the agent script body. Babel parses the inline `<script type="text/babel">`
 * as JSX, so a single non-text byte (e.g. PNG magic 0x89 / UTF-8 replacement
 * 0xEF 0xBF 0xBD) aborts the whole bundle with
 *   "Inline Babel script: Unexpected character '\xEF'".
 *
 * Triggered in production after the paste-image-into-chat feature: pasted PNGs
 * land in `uploads/` and PreviewPanel re-fetches files → buildSrcdoc tries to
 * concat the PNG body into the babel script → preview crashes.
 */
const BINARY_MIME_PREFIXES: readonly string[] = ['image/', 'audio/', 'video/'];
const BINARY_MIME_EXACT: ReadonlySet<string> = new Set(['application/octet-stream']);

/**
 * Path extensions that are always binary, used as a fallback when `mimeType`
 * is empty / unknown.
 */
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'pdf',
  'zip',
  'mp4',
  'mp3',
  'wav',
  'woff',
  'woff2',
  'ttf',
  'eot',
]);

/**
 * 判断一个 BundleFile 能否安全地内联到 `<script type="text/babel">` body。
 *
 * 规则（短路顺序）：
 *   1. mimeType 命中已知 binary（image/* / audio/* / video/* / octet-stream）→ false
 *   2. mimeType 是 text/* 或 application/json → true
 *   3. 否则（mime 缺失/未知）按 path 扩展名兜底；扩展名在 BINARY_EXTENSIONS 中 → false
 *   4. 默认 → true（保守保留，避免漏内联用户真实写的 source）
 *
 * 设计目的：拼装 srcdoc 时排除非文本 file，防止 Babel 把 PNG bytes 当 JSX 解析。
 */
export function isInlineableTextFile(file: BundleFile): boolean {
  const mime = file.mimeType?.toLowerCase().trim() ?? '';
  if (mime) {
    if (BINARY_MIME_EXACT.has(mime)) return false;
    for (const prefix of BINARY_MIME_PREFIXES) {
      if (mime.startsWith(prefix)) return false;
    }
    if (mime.startsWith('text/') || mime === 'application/json') return true;
    // mime 已知但既不是 text/json 也不是已知 binary → 落到 extension 兜底。
  }
  const ext = file.path.toLowerCase().split('.').pop() ?? '';
  if (BINARY_EXTENSIONS.has(ext)) return false;
  return true;
}

/**
 * 转义 source 里的字面 `</script>` 序列，防止它在 srcdoc 里提前关闭外层 `<script>`。
 *
 * **任何**经手用户/agent 输出的字符串（agent script 内容、originalScript JS 字面量）
 * 在塞进 srcdoc 前都必须经过这个 escape，否则 HTML parser 会把外层 script 提前关掉，
 * 之后所有代码就泄漏到 HTML body 里。
 */
export function escapeForScript(source: string): string {
  // 注意：替换值在 TS 源里写 `'<\\/script>'`（双反斜杠）—— JS parser 解析后字符串 value
  // 含**字面 `\`**：`<\/script>`（10 个字符）。当这个字符串写入 iframe 的 srcdoc 后，
  // 内层 HTML parser 看到 raw 字符 `<` 紧跟 `\`，**不会**识别为 close-tag —— 安全。
  // 反之若写 `'<\/script>'`（单反斜杠），JS 解析为 `</script>`（9 char，无 `\`），
  // 写入 srcdoc 后会被 HTML parser 当 close-tag —— 这正是我们要避免的。
  return source.replace(/<\/script>/g, '<\\/script>');
}

/**
 * 文件依赖排序启发式 —— 按常见的多文件项目命名习惯。
 *
 * 顺序（小到大执行）：
 *   themes/data.jsx → primitives.jsx → ios-frame.jsx → screen-*.jsx → app.jsx (EDITMODE)
 *
 * 同优先级时按 path 字典序。EDITMODE 文件总是最后（agent 脚本入口）。
 */
export function sortFilesForExecution(
  files: readonly BundleFile[],
  editmodeFile: string | null,
): BundleFile[] {
  const order = (name: string): number => {
    if (editmodeFile && name === editmodeFile) return 100;
    if (/^screen-/.test(name)) return 50;
    if (name === 'data.jsx' || name === 'themes.jsx' || name === 'themes/data.jsx') return 10;
    if (name === 'primitives.jsx') return 20;
    if (name === 'ios-frame.jsx') return 30;
    return 40;
  };
  return [...files].sort((a, b) => {
    const oa = order(a.path);
    const ob = order(b.path);
    if (oa !== ob) return oa - ob;
    return a.path.localeCompare(b.path);
  });
}

/**
 * 找含 EDITMODE 块的第一个文件，返回 path；找不到时返回 null。
 */
export function findEditmodeFile(files: readonly BundleFile[]): string | null {
  for (const f of files) {
    if (f.content.includes('/*EDITMODE-BEGIN*/')) return f.path;
  }
  return null;
}

/**
 * bundle 里是否已经有 `ReactDOM.createRoot(...).render(...)` 调用。
 *
 * 用于决定是否需要追加自动 entry。
 */
export function hasEntryCall(files: readonly BundleFile[]): boolean {
  return files.some((f) => HAS_ENTRY_RE.test(f.content));
}

// ---------------------------------------------------------------------------
// CDN script tag 拼接
// ---------------------------------------------------------------------------

function makeCdnScript(src: string, integrity: string | undefined): string {
  if (integrity) {
    return `<script src="${src}" integrity="${integrity}" crossorigin="anonymous"></script>`;
  }
  return `<script src="${src}" crossorigin></script>`;
}

// ---------------------------------------------------------------------------
// buildSrcdoc 主函数
// ---------------------------------------------------------------------------

/**
 * 把多文件 bundle 拼装成完整的 iframe srcdoc HTML 字符串。
 *
 * 流程：
 *   1. 按 sortFilesForExecution 排序；EDITMODE 文件放最后
 *   2. 把所有文件 escape `</script>` 后用 `// ===== <path> =====` 注释拼接
 *   3. 如 bundle 里没 `ReactDOM.createRoot(...).render(...)`，自动追加 ENTRY_RENDER_CALL
 *   4. 拼装 HTML：head 里加 React/ReactDOM/Babel CDN + integrity（如有）+ Tweaks setup
 *   5. body 里 `<script type="text/babel">` 包 agent script
 *   6. agent script 后注入 `originalScript` 字面量给 Tweaks listener 用
 *   7. 最末注入 Tweaks listener + Overlay script
 *
 * @returns 完整 HTML 字符串，可直接给 `iframe.srcdoc` 用。
 */
export function buildSrcdoc(
  files: readonly BundleFile[],
  options: BuildSrcdocOptions = {},
): string {
  const reactCdn = options.reactCdn ?? DEFAULT_CDN;
  const babelCdn = options.babelCdn ?? DEFAULT_CDN;
  const injectOverlay = options.injectOverlay ?? true;
  const injectTweaks = options.injectTweaks ?? true;
  const injectInlineErrorHandler = options.injectInlineErrorHandler ?? true;

  // Drop binary files (image / audio / video / octet-stream / known binary
  // extensions) BEFORE any other processing — they must not reach the babel
  // script body, otherwise raw bytes are parsed as JSX and the whole bundle
  // aborts with "Inline Babel script: Unexpected character '\xEF'". Binary
  // files still live in the project file tree (PreviewPanel renders them
  // separately) and remain reachable at runtime via
  // `<img src="/api/projects/.../files/uploads/x.png">` URLs.
  const inlineable = files.filter(isInlineableTextFile);

  const editmodeFile = findEditmodeFile(inlineable);
  const sorted = sortFilesForExecution(inlineable, editmodeFile);

  // 拼接所有文件成单 bundle（共享 scope）。
  // Each file is run through stripModuleSyntax FIRST so any `import` /
  // `export` statements the agent wrote (a reflexive React idiom) are
  // removed before they reach Babel — Babel's react preset doesn't handle
  // ES modules, so a single `import` line aborts the whole bundle with
  // "Cannot use import statement outside a module".
  const concatenated = sorted
    .map((f) => `// ===== ${f.path} =====\n${escapeForScript(stripModuleSyntax(f.content))}`)
    .join('\n\n');

  const needsEntry = !hasEntryCall(sorted);
  // Prepend the React-globals prelude so bare `useState(...)`, `<Fragment>`,
  // `forwardRef`, etc. resolve via `window.React`. Required because we just
  // stripped the agent's `import { useState } from 'react'` statements.
  const fullAgentScript =
    `// ===== React globals prelude (open-design runtime) =====\n${REACT_GLOBALS_PRELUDE}\n\n` +
    concatenated +
    (needsEntry ? `\n\n// ===== auto-entry =====\n${ENTRY_RENDER_CALL}` : '');

  // originalScript 字面量供 Tweaks listener 重编译时取用 —— 必须 JSON.stringify 后再
  // escape `</script>`，否则字符串里的 `</script>` 会泄漏到 HTML 流。
  const originalScriptLiteral = injectTweaks
    ? escapeForScript(JSON.stringify(fullAgentScript))
    : null;

  // CDN URLs
  const reactSrc = `${reactCdn.replace(/\/$/, '')}/${REACT_DEV_PATH}`;
  const reactDomSrc = `${reactCdn.replace(/\/$/, '')}/${REACT_DOM_DEV_PATH}`;
  const babelSrc = `${babelCdn.replace(/\/$/, '')}/${BABEL_PATH}`;

  const integ = options.integrityHashes;
  const reactScriptTag = makeCdnScript(reactSrc, integ?.react);
  const reactDomScriptTag = makeCdnScript(reactDomSrc, integ?.reactDom);
  const babelScriptTag = makeCdnScript(babelSrc, integ?.babel);

  const lines: string[] = [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<style>',
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}',
    'html,body,#root{height:100%;}',
    'body{font-family:system-ui,sans-serif;background:#faf7f2;}',
    '</style>',
  ];

  // Inline error handler MUST run before Babel processes inline scripts.
  // Source text is stashed in a global so the placeholder can show the
  // offending line + caret. We escape both the JSON literal (close-script
  // hazard via raw user content) and the IIFE source.
  //
  // Leading `\n` alignment: when Babel parses our `<script type="text/babel">`
  // block, the script body it sees begins with the newline immediately after
  // the opening tag (see how the AGENT_BODY block is assembled below — lines
  // are joined with `\n`, so there's a `\n` between `<script>` and the first
  // agent line). Babel reports `(line:col)` against that view, treating the
  // newline as line 1. The captured source must mirror this — prepend a `\n`
  // so `lines[lineno - 1]` in the placeholder code resolves to the offending
  // agent line under Babel's numbering, not one line below.
  const inlineErrorSourceLiteral = injectInlineErrorHandler
    ? escapeForScript(JSON.stringify('\n' + fullAgentScript))
    : null;
  if (injectInlineErrorHandler && inlineErrorSourceLiteral !== null) {
    lines.push(
      '<script>window.' +
        INLINE_ERROR_SOURCE_GLOBAL +
        '=' +
        inlineErrorSourceLiteral +
        ';</script>',
      '<script>' + escapeForScript(buildInlineErrorHandlerScript()) + '</script>',
    );
  }

  lines.push(
    // Tailwind play CDN — agents reflexively write `className="bg-blue-500
    // px-4 py-2"`. Without this script, those classes land in the DOM but
    // produce no styling and the artifact looks broken (regression caught
    // E2E during the counter test). Play CDN includes the JIT compiler so
    // arbitrary utility names resolve at runtime; ~80KB gzipped on first
    // load, browser-cached after. The system prompt OUTPUT_FORMAT_OVERRIDE
    // promises Tailwind utilities work — this is what makes that true.
    '<script src="https://cdn.tailwindcss.com"></script>',
    // Google Fonts — agent often references Inter / Instrument Serif / etc.
    // Pre-loading the most common families means className="font-serif" or
    // inline `font-family: Inter` actually renders the right typeface.
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">',
    '</head><body>',
    '<div id="root"></div>',
    reactScriptTag,
    reactDomScriptTag,
    babelScriptTag,
  );

  if (injectTweaks) {
    lines.push('<script>' + escapeForScript(buildTweaksBridgeSetup()) + '</script>');
  }

  lines.push(
    '<!-- AGENT_BODY_BEGIN -->',
    '<script type="text/babel" data-presets="react" data-filename="bundle.jsx">',
    fullAgentScript,
    '</script>',
    '<!-- AGENT_BODY_END -->',
  );

  if (injectTweaks && originalScriptLiteral !== null) {
    lines.push(
      '<script>if(window.__codesign_tweaks__){window.__codesign_tweaks__.originalScript=' +
        originalScriptLiteral +
        ';}</script>',
      '<script>' + escapeForScript(buildTweaksBridgeListener()) + '</script>',
    );
  }

  if (injectOverlay) {
    lines.push('<script>' + escapeForScript(buildOverlayScript()) + '</script>');
  }

  lines.push('</body></html>');

  return lines.join('\n');
}
