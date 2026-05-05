// Data-driven test cases.
//
// 第一批先把骨架立起来（home / create / send chat / preview render），
// 其余 case 标 automated:false 留给后续迭代。

export interface CaseEntry {
  id: string;
  name: string;
  automated: boolean;
  notes?: string;
}

export const cases: CaseEntry[] = [
  {
    id: 'home-loads',
    name: 'Home page loads — logo + Create button visible',
    automated: true,
    notes: '最基础 smoke：vite dev 起来 + react root mount + Home 渲染',
  },
  {
    id: 'create-project',
    name: 'New project: type a name → click Create → land on workspace',
    automated: true,
    notes: '验证 POST /api/projects + navigate /p/:id + workspace shell mount',
  },
  {
    id: 'send-chat-prompt',
    name: 'Chat composer: send a prompt → see mock OpenRouter response → see tool call rendered',
    automated: true,
    notes: '依赖 mockOpenRouter；验证 useAgentChat → useChat 流水跑通',
  },
  {
    id: 'iframe-renders-default-app',
    name: 'After mock writes App.jsx, iframe should render the user component',
    automated: true,
    notes: '验证 PreviewIframe srcdoc + entry-file pick + react-runtime',
  },
  {
    id: 'switch-tweaks-mode',
    name: 'Toolbar Tweaks button: click → button becomes active',
    automated: false,
    notes: '需要 Preview 已有内容；先验证 toolbar 按钮的 active 态切换即可',
  },
  {
    id: 'switch-comment-mode',
    name: 'Toolbar Comment button: click → hover element shows selection box',
    automated: false,
  },
  {
    id: 'switch-edit-mode',
    name: 'Toolbar Edit button: click → property edit float appears on element',
    automated: false,
  },
  {
    id: 'switch-draw-mode',
    name: 'Toolbar Draw button: click → DrawDock visible',
    automated: false,
  },
  {
    id: 'file-tree-shows-app-jsx',
    name: 'Design Files tab: shows App.jsx after mock generation',
    automated: false,
    notes: '现 send-chat-prompt 已经覆盖了，独立这条留作后续 stricter 检查',
  },
  {
    id: 'file-source-vs-preview-tab',
    name: 'Click App.jsx in tree → default Preview tab → switch source tab → see code',
    automated: false,
    notes: 'split-pane right side, FilePreviewPane vs FileSourceView',
  },
];

export function automatedCases(): CaseEntry[] {
  return cases.filter((c) => c.automated);
}
