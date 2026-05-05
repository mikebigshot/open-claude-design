// Pure helpers for the file tree + iframe entry-file selection.
//
// Section grouping: by FileRecord.mimeType (worker normalizes via inferMime).
//
// Entry priority: HTML-first.
// .html 归为 'PAGES'（独立可渲染入口），.jsx 归为 'COMPONENTS'（被 page
// import 的组件，不能独立渲染）。HTML 是优先入口；jsx-only 项目（agent 暂时
// 还没生成 .html wrapper 时）才回退到 jsx 入口选 React 风格。zip-export
// 已自动给项目加 standalone HTML wrapper —— import 进来后会有 .html 入口正确选中。

import type { FileRecord } from '@open-design/contracts';

export type Section = 'PAGES' | 'COMPONENTS' | 'SCRIPTS' | 'IMAGES' | 'SKETCHES' | 'OTHER';

/**
 * Pick an entry file from a list of project file paths.
 * Returns null when no candidate matches.
 *
 * 顺序（HTML-first）：
 *   1. 任意 .html / .htm（命名包含 'index' / 'app' / 'main' 的优先；其余按
 *      字母序）—— 主 'page' 入口
 *   2. fallback: app.jsx → app.tsx → index.jsx → index.tsx → 第一个 .jsx/.tsx
 *      （jsx-only 项目时回退到 React 入口，让 in-app preview 仍可工作）
 */
export function pickEntry(paths: string[]): string | null {
  if (paths.length === 0) return null;

  // Lower-case lookup: case-insensitive match for canonical names; original
  // casing preserved in the returned path (so the file tree highlight matches).
  const byLower = new Map<string, string>();
  for (const p of paths) byLower.set(p.toLowerCase(), p);

  // ── 1. HTML-first ──
  const htmlPaths = paths.filter((p) => /\.html?$/i.test(p));
  if (htmlPaths.length > 0) {
    // 命名约定优先：index.html > app.html > main.html > 'index/app/main' 子串 >
    // 字母序最小
    const canonical = ['index.html', 'app.html', 'main.html'];
    for (const c of canonical) {
      const found = byLower.get(c);
      if (found && htmlPaths.includes(found)) return found;
    }
    // base name 含 'index' / 'app' / 'main' 子串 —— 跨子目录命名约定（如
    // 'pages/index.html', 'src/app.html'）
    const partial = htmlPaths.find((p) => {
      const base = (p.split('/').pop() ?? '').toLowerCase();
      return /(?:^|[\\W_])(index|app|main)(?:[\\W_]|$)/.test(base);
    });
    if (partial) return partial;
    // 否则按字母序选最小 —— 多 page 项目用户首次进入时显示稳定的入口
    return [...htmlPaths].sort()[0] ?? null;
  }

  // ── 2. JSX fallback（jsx-only 项目）──
  const jsxCandidates = ['app.jsx', 'app.tsx', 'index.jsx', 'index.tsx'];
  for (const c of jsxCandidates) {
    const found = byLower.get(c);
    if (found) return found;
  }
  const firstReact = paths.find((p) => /\.(jsx|tsx)$/i.test(p));
  if (firstReact) return firstReact;

  return null;
}

/**
 * Group a file by its mime type into one of 6 sections.
 *
 * PAGES / COMPONENTS 分开：.html → PAGES（独立渲染入口）；
 * .jsx/.tsx → COMPONENTS（被 page import 的组件）。
 */
export function sectionFor(file: FileRecord): Section {
  const m = file.mimeType;
  if (m === 'text/html') return 'PAGES';
  if (m === 'text/jsx') return 'COMPONENTS';
  if (m.startsWith('image/')) return 'IMAGES';
  if (m === 'text/javascript' || m === 'text/css') return 'SCRIPTS';
  return 'OTHER';
}

/**
 * Decide whether a file path should render as a live iframe preview (HTML
 * pages) versus its source code. Used by Workspace.tsx to route between
 * PreviewPanel (live) and FileSourceView (read-only source).
 *
 * Anything HTML — including non-entry HTML pages — goes to live preview.
 * (The PreviewPanel still picks an entry internally; if the project is
 * React-based, opening any HTML still renders the React entry. Acceptable
 * for now: real cross-page navigation lives behind the iframe.)
 */
export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path);
}
