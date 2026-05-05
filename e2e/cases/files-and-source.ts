// 文件树 / 源码 / Preview tab 切换 / 入口选择 / 路径边界 e2e cases.
//
// 这批 case 跟 main-flow 的 'iframe-renders-default-app' 错开关注点：
//   - main-flow 验"chat → 文件落盘 → preview 渲染"链路
//   - 这里验"文件树 + tab 切换 + 源码视图 + 入口优先级 + 边界"
//
// 设计原则：每条 case 至少 3 个用户视角断言，跑得通的不留 TODO，跑不通
// 的标 fixme + SUSPECTED BUG 注释。每个 case 自带说明。

export interface FilesAndSourceCase {
  id: string;
  name: string;
  /** 跑通的 → true。fixme 的 → false（test.fixme + 注释原因）。 */
  automated: boolean;
  notes?: string;
}

export const filesAndSourceCases: FilesAndSourceCase[] = [
  // ── 文件树点击 + tab 切换 ──
  {
    id: 'F-1-tree-shows-app-jsx',
    name: 'After mock writes App.jsx, file tree shows the row + click selects it',
    automated: true,
    notes:
      '基础"列出 + 点击"——验 file-tree-item-App.jsx 可见、点了之后 row data-active=true 且 FilePreviewPane 标题切到 App.jsx。',
  },
  {
    id: 'F-2-default-renders-preview',
    name: 'After agent generates App.jsx, default workspace view is iframe Preview (not source)',
    automated: true,
    notes:
      'P0 SUSPECTED BUG: ChatPanel.tsx line 175-178 把 set_active_tab 设成文件路径——.jsx 路径不是 PREVIEW_TAB 也不是 .html，所以 Workspace.tsx 路由到 FileSourceView。生成完 .jsx 用户期望直接看 preview iframe，不是看代码。test.fixme 直到主线修。',
  },
  {
    id: 'F-3-switch-to-source-shows-code',
    name: 'Open file tab → switch to source view → see literal mock content',
    automated: true,
    notes:
      '走"FilePreviewPane 里点 Open → activeTab 变成 file path → FileSourceView 渲染"的路径——这是当前 split-layout 里看源代码的官方流程。验 file-source-view 可见 + 含 mock 写入的字面量（data-testid="mock-app-heading"）。',
  },
  {
    id: 'F-4-source-preview-toggle-iframe-survives',
    name: 'Source ↔ Preview toggle preserves iframe state (no remount on each switch)',
    automated: true,
    notes:
      'iframe 持久化：切到 Source 再切回 Preview，iframe contentWindow 上写的 timestamp 还在。如果 iframe remount，timestamp 会消失——这是常见的 React key 抖动 / 父组件 unmount 漏洞。',
  },

  // ── 入口文件选择优先级 ──
  {
    id: 'E-1-app-jsx-wins-over-index-jsx',
    name: 'Multi-entry: App.jsx + index.jsx → iframe renders App.jsx',
    automated: true,
    notes:
      '验 pickEntry 在多 entry 候选里按优先级（App.jsx > index.jsx）选——通过把两个文件都注入并断言 iframe 里看到的是 App.jsx 的 marker，不是 index.jsx 的。',
  },
  {
    id: 'E-2-html-only-renders-via-html-srcdoc',
    name: 'HTML-only project: iframe renders index.html content directly (no babel mount)',
    automated: true,
    notes:
      '验 buildHtmlSrcdoc / pickHtmlEntry 路径——纯 .html 项目时不应走 React babel 路径，iframe srcdoc 直接是 HTML。',
  },

  // ── 路径边界 ──
  {
    id: 'P-1-nested-path-button',
    name: 'Nested path: src/components/Button.jsx + App.jsx → tree row visible + clickable',
    automated: true,
    notes:
      'mock 落带斜杠的路径，验 file-tree-item-src/components/Button.jsx 可见、可点，FilePreviewPane 切到该文件后可以加载内容。',
  },
  {
    id: 'P-2-special-chars-space',
    name: 'Special chars in path: "src/foo bar.jsx" (space) → tree row + content load OK',
    automated: true,
    notes:
      '路径里带空格——容易因 URL encode 漏掉而 404。验 tree row 可见、点了之后 FilePreviewPane 显示文件名+内容（不是 404 错误）。',
  },

  // ── 错误路径 ──
  {
    id: 'ER-1-nonexistent-file-tab',
    name: 'open file tab for a file that does not exist on server → error UI, not blank',
    automated: true,
    notes:
      '手动 dispatch open_file 给一个 server 上不存在的路径——FileSourceView 应该显示明确错误（file-source-error testid），不是空白。',
  },

  // ── a11y ──
  {
    id: 'A11Y-1-file-tree-keyboard-reachable',
    name: 'File tree exposes WAI-ARIA Tree pattern + ArrowUp/Down navigation + Enter activates',
    automated: true,
    notes:
      'role="tree" / role="treeitem" / aria-selected / roving tabindex (active row tabindex=0, 其余 -1) + ArrowDown/Up 在 row 间移 focus + Enter 等同点击。覆盖 WAI-ARIA Tree pattern 子集（无文件夹展开/收起）。',
  },
  {
    id: 'A11Y-2-file-source-view-region-and-live',
    name: 'FileSourceView root has role="region" + aria-label + aria-live="polite"',
    automated: true,
    notes:
      '切文件时屏幕阅读器需要听到反馈——root 用 role="region" + aria-label="File source view" 让 AT 把它当独立 landmark, aria-live="polite" 让 path 变化触发 polite 播报。loading 用 role="status", error 用 role="alert"——只在 unit test 里覆盖（e2e 难造 loading/error 状态）。',
  },
];

export function automatedFilesAndSourceCases(): FilesAndSourceCase[] {
  return filesAndSourceCases.filter((c) => c.automated);
}
