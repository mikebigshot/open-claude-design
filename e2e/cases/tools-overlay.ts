// 4 工具浮窗 e2e cases — Tweaks / Comment / Edit / Draw
//
// 覆盖：模式切换 / 进入条件 / 持久化 / postMessage 协议 / 跨工具互斥 /
// race / a11y。每条 case 至少 3 个 assertion，关键 case 5+。
//
// 运行依赖：dev server (5173 + 8787)、injectByok、mockOpenRouter（artifactFiles
// 注入 EDITMODE-aware App.jsx）。
//
// 设计原则：
//   - id = kebab-case 短名（spec 内 switch 用）
//   - notes = 解释为什么这条独立存在（不重复 main-flow）
//   - automated:false 必须带 reason — 不接受沉默 TODO

export interface ToolsOverlayCase {
  id: string;
  name: string;
  automated: boolean;
  notes?: string;
  /** Skip reason — 必须填，否则 spec runner 报错 */
  skipReason?: string;
}

export const toolsOverlayCases: ToolsOverlayCase[] = [
  // ─────────── Tweaks ───────────
  {
    id: 'tweaks-enter-mode',
    name: 'Tweaks: click button → active state, switching to other tool exits Tweaks',
    automated: true,
    notes: '验 toolbar active 态 + workspace.tool 状态 + 其它 tool 进入会切走',
  },
  {
    id: 'tweaks-artifact-roundtrip',
    name: 'Tweaks: artifact 写回 EDITMODE artifact (协议字面量)',
    automated: true,
    notes: '验 EDITMODE-BEGIN/END 在源码中存在；__edit_mode_set_keys 触发 PUT',
  },

  // ─────────── Comment ───────────
  {
    id: 'comment-hover-shows-outline',
    name: 'Comment: 进入 mode 后 hover iframe 元素显示 outline + cursor 变 crosshair',
    automated: true,
    notes: '依赖 overlay.ts onMouseOver；hover 时 element.style.outline 应被设',
  },
  {
    id: 'comment-pin-create-and-persist',
    name: 'Comment: click iframe 元素 → draft pin overlay → 输入文本 → Save → reload 持久化',
    automated: true,
    notes: '验 ELEMENT_SELECTED + draft pin + POST /api/comments + reload',
  },

  // ─────────── Edit ───────────
  {
    id: 'edit-select-shows-float',
    name: 'Edit: click iframe 元素 → EditFloat 出现 + selection tag 显示',
    automated: true,
    notes: '验 EditFloat data-testid + selection-tag = clicked tag name',
  },
  {
    id: 'edit-style-change-emits-postmessage',
    name: 'Edit: 改 background swatch → EDIT_STYLE postMessage → leave mode 时持久化',
    automated: true,
    notes: '验本 hop 全链：UI → postMessage → tool 切走时 PUT 到 /api/files',
  },

  // ─────────── Draw ───────────
  {
    id: 'draw-dock-visible',
    name: 'Draw: 进入 mode → DrawDock 出现 + 工具栏（Draw/Point/Voice/Send）齐',
    automated: true,
    notes: '验 dock testid + submode buttons + Voice disabled + Send/Discard',
  },
  {
    id: 'draw-stroke-on-canvas',
    name: 'Draw: pointer down/move/up 在 canvas 上 → polyline 出现',
    automated: true,
    notes: '真实模拟 pointer events；验 SVG polyline 数量 +1',
  },

  // ─────────── 跨工具 / 错误路径 ───────────
  {
    id: 'tool-switch-mutual-exclusion',
    name: '工具切换互斥：A → B 时 A active 退出 B active 进入',
    automated: true,
    notes: '验 4 个 tool 之间两两切换都符合互斥；data-active 属性',
  },
  {
    id: 'tool-toggle-off',
    name: '同一工具按钮第二次点击 → 关闭工具（active false）',
    automated: true,
    notes: '验单工具 toggle 行为；setTool(null) 路径',
  },
  {
    id: 'tool-button-keyboard-a11y',
    name: 'a11y: Tab 到工具按钮 + Enter 键触发',
    automated: true,
    notes: '验 aria-pressed + 键盘可达；focus-visible 不验视觉只验状态',
  },
  {
    id: 'iframe-not-ready-tool-click',
    name: 'iframe 还没 ready 时点工具按钮 — 不应卡死/抛 console.error；P2-13 显示 empty-iframe hint',
    automated: true,
    notes:
      'race 边界：刚创建 project / iframe 没 srcdoc 时点工具。P2-13 后 EditFloat / DrawDock 不渲染，改显示 "Generate a preview first" hint',
  },
  {
    id: 'tweaks-put-failure-shows-toast',
    name: 'Tweaks: PUT 失败 → 用户可见的 toast (P1-8)',
    automated: true,
    notes:
      'mock 拦 PUT /api/projects/:id/files/* 返 500 → 触发 __edit_mode_set_keys → 验 toast 出现 + role=alert',
  },
];

export function automatedToolsOverlayCases(): ToolsOverlayCase[] {
  return toolsOverlayCases.filter((c) => c.automated);
}
