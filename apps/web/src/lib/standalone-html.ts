// 生成 zip-export 内的 single-file HTML wrapper：
//   - <head> meta + Google Fonts preconnect + 简单 <style>
//   - 三段 unpkg CDN: react / react-dom / @babel/standalone (含 SRI integrity)
//   - 每个 jsx 文件一段 `<script type="text/babel" src="./<path>">` 引用旁边
//     的相对路径（zip 解压后双击 HTML 浏览器走 file:// 加载 sibling .jsx）
//   - 末尾内联 `ReactDOM.createRoot(...).render(<App />);`
//
// 用户解压 zip → 双击 HTML → 浏览器跑 React/Babel 运行时编译 → 渲染。
// **不预编译** JSX，让导出物开箱可改、可读。

import {
  type BundleFile,
  findEditmodeFile,
  hasEntryCall,
  sortFilesForExecution,
} from '@open-design/iframe-runtime/build-srcdoc';

// CDN 版本 + SRI integrity hash 锁定。换版本时必须同时换 integrity
// （用 https://srihash.org）—— 跟 build-srcdoc 顶部的版本号保持同步。
const REACT_VERSION = '18.3.1';
const REACT_DOM_VERSION = '18.3.1';
const BABEL_VERSION = '7.29.0';

const SRI_REACT = 'sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L';
const SRI_REACT_DOM = 'sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm';
const SRI_BABEL = 'sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y';

export interface StandaloneHtmlOptions {
  /** 显示在 `<title>` 里。默认 = projectName */
  title?: string;
  /** 项目名（用于派生标题等） */
  projectName: string;
  /** 项目所有源文件 —— 按 sortFilesForExecution 排序后嵌 script src */
  files: readonly BundleFile[];
  /** 如果 bundle 内没有 `ReactDOM.createRoot(...).render(...)`，则附加默认 entry call。
      默认 'App'（跟 build-srcdoc 默认一致） */
  defaultRootComponent?: string;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isJsxLikePath(path: string): boolean {
  return /\.(jsx|tsx)$/i.test(path);
}

/**
 * 生成 standalone HTML 字符串。HTML 内的 `<script src="./<path>">` 引用相对路径，
 * 所以**用户必须把这个 HTML 跟所有 jsx 文件放在 zip 同一目录** —— zip-export
 * 已经保证这一点（HTML 跟所有 source files 一起进 zip 根）。
 */
export function buildStandaloneHtml(opts: StandaloneHtmlOptions): string {
  const title = opts.title ?? opts.projectName;
  const rootComponent = opts.defaultRootComponent ?? 'App';

  // 只把 .jsx / .tsx 文件作为 script tag 引入；其它文件（图片 / css / json）
  // 作为相对资源静默存在。
  const jsxFiles = opts.files.filter((f) => isJsxLikePath(f.path));
  const editmodeFile = findEditmodeFile(jsxFiles);
  const sorted = sortFilesForExecution(jsxFiles, editmodeFile);

  // 用户在 jsx 里已经写了 entry call (ReactDOM.createRoot(...).render(...))？
  // 是 → 不追加额外 entry script
  // 否 → 追加默认 entry: render(<App />)
  // 注意：这跟 build-srcdoc 行为对齐，让 srcdoc preview 跟下载的 HTML 同样的 entry 选择。
  const needAutoEntry = !hasEntryCall(sorted);

  const scriptTags = sorted
    .map(
      (f) =>
        `<script type="text/babel" src="./${escapeAttr(f.path)}" data-presets="react" data-filename="${escapeAttr(f.path)}"></script>`,
    )
    .join('\n  ');

  const autoEntry = needAutoEntry
    ? `<script type="text/babel" data-presets="react">
    ReactDOM.createRoot(document.getElementById('root')).render(<${rootComponent} />);
  </script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; }
  *, *::before, *::after { box-sizing: border-box; }
</style>
</head>
<body>
  <div id="root"></div>
  <script src="https://unpkg.com/react@${REACT_VERSION}/umd/react.development.js" integrity="${SRI_REACT}" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@${REACT_DOM_VERSION}/umd/react-dom.development.js" integrity="${SRI_REACT_DOM}" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@${BABEL_VERSION}/babel.min.js" integrity="${SRI_BABEL}" crossorigin="anonymous"></script>
  ${scriptTags}
  ${autoEntry}
</body>
</html>
`;
}

/**
 * 生成 zip 内的 HTML 文件名 —— "<Project Name> Prototype.html"。
 * 项目名含特殊字符（如 / : *）替换为 -。
 */
export function deriveStandaloneHtmlFilename(projectName: string): string {
  const cleaned = projectName.replace(/[\\/:*?"<>|]/g, '-').trim();
  const safe = cleaned.length > 0 ? cleaned : 'Project';
  return `${safe} Prototype.html`;
}
