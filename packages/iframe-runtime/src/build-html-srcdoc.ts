// build-html-srcdoc.ts — HTML-only 项目的 srcdoc 路径。
//
// 跟 buildSrcdoc 互补：buildSrcdoc 处理多文件 React/JSX bundle（走 Babel
// Standalone 编译），buildHtmlSrcdoc 处理"已经是完整 HTML"的 entry——直接当
// srcdoc 喂 iframe，仅注入 OVERLAY_SCRIPT 让 4 工具（comment / edit / draw）
// 还能用。Tweaks / cached-root 不注入：HTML 模式没 React tree 可 reconcile，
// 也没 EDITMODE 块需要 source-mapping。
//
// 触发场景：agent 产出的项目里只有 .html / 没有 .jsx 文件（slide-deck /
// static-page / HTML email 等场景，单 HTML 内含 React script）。

import { REACT_GLOBALS_PRELUDE } from './build-srcdoc';
import { buildOverlayScript } from './overlay';

export interface BuildHtmlSrcdocOptions {
  /** 是否注入 OVERLAY_SCRIPT（comment / edit / draw 4 工具）。默认 true。 */
  readonly injectOverlay?: boolean;
  /**
   * `<base href>` 注入。zip-export 产出的 standalone HTML
   * 用相对路径 `<script src="./app.jsx">` 引用 sibling jsx 文件。srcdoc
   * iframe 没自己的 base URL，浏览器会按 parent window URL 解析相对路径，
   * fetch 到 SPA fallback HTML 而非真 jsx 内容 → Babel SyntaxError → React
   * 不启动 → 看似有 UI（chrome extension 注入的 dehydrated tree）但点击全
   * 失效。注入 `<base href>` 重定向到 `/api/projects/:id/files/` 让浏览器
   * 命中真文件。
   */
  readonly baseHref?: string;
}

/**
 * 把已经是完整 HTML 的 entry 包装成 iframe srcdoc。
 *
 * 注入策略：
 *   1. `<base>`（如有 baseHref）插到 `<head>` 开头 —— 必须在所有相对 URL
 *      `<script src>` / `<link href>` 之前
 *   2. overlay `<script>` 插到 `</body>` 前
 *
 * 同时清洗已知脏数据：
 *   - `<script src="chrome-extension://...">` 是用户机器上的 browser
 *     extension（如 React DevTools 的 inspector）注入的脏数据，下载到本机加载会
 *     ERR_FAILED；剥掉避免 console 报错
 *   - `<input ... data-inspect-config="...">` 同样是 inspector extension 副产物
 */
export function buildHtmlSrcdoc(htmlContent: string, options: BuildHtmlSrcdocOptions = {}): string {
  const injectOverlay = options.injectOverlay ?? true;
  const baseHref = options.baseHref;

  let html = htmlContent;

  // 1. 清洗 chrome-extension 注入的脏数据 —— React DevTools / inspector
  //    extension 会把当前页的 React tree dump 成 inline React.createElement
  //    script 注入到 export 出的 HTML <head> 里。这些 inline block 含
  //    `_jsxFileName` / `function _typeof` 等 babel runtime helper，在我们浏览器
  //    跑时 React 还没 load 就开始执行 → ReferenceError + 整个页面挂掉。
  html = html.replace(/<script[^>]*src="chrome-extension:\/\/[^"]*"[^>]*>\s*<\/script>/gi, '');
  html = html.replace(/<input[^>]*data-inspect-config[^>]*>/gi, '');
  // 删 <head> 内**所有** inline <script>（无 src 属性，且 type 不是 text/babel）。
  // 合法用法是 `<script src="https://unpkg.com/...">` (CDN React/Babel) 或
  // `<script type="text/babel" src="./xxx.jsx">` (sibling jsx)；都带 src。
  // head 内出现 inline JS 几乎只能是 extension dump。
  html = html.replace(/<head([^>]*)>([\s\S]*?)<\/head>/i, (_match, attrs, headBody) => {
    const cleaned = (headBody as string).replace(
      /<script(?![^>]*\bsrc=)(?![^>]*type=["']text\/babel["'])[^>]*>[\s\S]*?<\/script>/gi,
      '',
    );
    return `<head${attrs}>${cleaned}</head>`;
  });

  // 2. 注入 <base href> 让相对路径 jsx fetch 到正确 endpoint
  if (baseHref) {
    const baseTag = `<base href="${escapeAttr(baseHref)}">`;
    if (/<head[^>]*>/i.test(html)) {
      // 插到 <head> 开标签后第一个位置 —— 必须在所有 <script src> / <link>
      // 之前
      html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
    } else {
      // 没 <head>（极简 fragment），追加在最前
      html = `${baseTag}\n${html}`;
    }
  }

  // 3. 注入 React globals prelude —— 生成的 jsx 常常用 useState() 而非
  //    React.useState()。React UMD 仅暴露 React + ReactDOM 全局，prelude 把
  //    hooks/Fragment 等 destructure 出来。必须在第一个 jsx <script> 之前、
  //    React/ReactDOM/Babel UMD 之后。Babel script 设 `data-presets="react"`
  //    让 prelude 自身可以是 jsx-aware（虽然这段是纯 JS）。
  const preludeTag = `<script type="text/babel" data-presets="react">\n${REACT_GLOBALS_PRELUDE}\n</script>`;
  // 找第一个 type="text/babel" script 把 prelude 插到它前面；如果没有 jsx
  // script（极简 HTML），插到 </head> 前。
  if (/<script[^>]+type=["']text\/babel["']/i.test(html)) {
    html = html.replace(
      /(<script[^>]+type=["']text\/babel["'][^>]*>)/i,
      `${preludeTag}\n$1`,
    );
  } else if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${preludeTag}\n</head>`);
  }

  // 4. 注入 overlay
  if (injectOverlay) {
    const overlayTag = `<script>${buildOverlayScript()}</script>`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${overlayTag}\n</body>`);
    } else {
      html = `${html}\n${overlayTag}`;
    }
  }

  return html;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 在一组文件里挑选最合适的 HTML entry。
 *
 * 优先级：
 *   1. `index.html` / `index.htm`
 *   2. `app.html` / `app.htm`（含大小写如 App.html）
 *   3. 第一个 `.html` / `.htm` 文件（按 path 字典序）
 *
 * 找不到任何 .html / .htm 时返回 null。
 *
 * 跟 isHtmlOnlyBundle 共用 `/\.html?$/i` 规则——避免出现"isHtmlOnlyBundle=true
 * 但 pickHtmlEntry=null"的矛盾态（纯 .htm 项目会落到这）。
 */
export function pickHtmlEntry<T extends { path: string }>(files: readonly T[]): T | null {
  const lower = (s: string) => s.toLowerCase();
  const byIndex = files.find((f) => {
    const p = lower(f.path);
    return p === 'index.html' || p === 'index.htm';
  });
  if (byIndex) return byIndex;
  const byApp = files.find((f) => {
    const p = lower(f.path);
    return p === 'app.html' || p === 'app.htm';
  });
  if (byApp) return byApp;
  const html = [...files]
    .filter((f) => /\.html?$/i.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  return html[0] ?? null;
}

/**
 * 判断一组文件是否应走 HTML-only 路径。
 *
 * 规则：没有任何 `.jsx` / `.tsx` / `.js` / `.ts` 文件，但至少有一个 `.html`。
 * 走这条路径意味着不调 buildSrcdoc / 不跑 Babel。
 */
export function isHtmlOnlyBundle<T extends { path: string }>(files: readonly T[]): boolean {
  const hasJsx = files.some((f) => /\.[jt]sx?$/i.test(f.path));
  const hasHtml = files.some((f) => /\.html?$/i.test(f.path));
  return !hasJsx && hasHtml;
}
