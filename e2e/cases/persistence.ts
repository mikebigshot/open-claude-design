// Persistence + multi-project isolation cases.
//
// 涵盖 4 类生产级场景：
//   1. Chat 历史持久化（reload 后恢复 / 中途 reload / 空状态 reload）
//   2. 文件持久化（reload 后保留 / 跨 reload 的文件树状态）
//   3. 多项目（Home 列表 / 切换项目 / 项目隔离）
//   4. 错误路径（不存在的 project / API 5xx）
//
// 跟 main-flow.spec.ts 一样，每条 case 是声明式条目；spec body 在
// e2e/specs/persistence.spec.ts 内按 id 分流。每条 case 必须有 automated:true，
// 不接受 fixme 留 TODO（生产级标准）。

import type { CaseEntry } from './index';

export const persistenceCases: CaseEntry[] = [
  // ───── Chat 历史持久化（H-*） ─────
  {
    id: 'chat-history-reload-restores-full-thread',
    name: 'H-1: Full chat thread (user + assistant + tool calls) survives page reload',
    automated: true,
    notes:
      '验 use-agent-chat hydration 路径：mock 完整流 → reload → GET /messages 恢复 → ' +
      'assistant 文本 + tool-write_file 部件都按时间序还原。',
  },
  {
    id: 'chat-history-reload-mid-stream',
    name: 'H-2: User message persists when reload happens mid-stream',
    automated: true,
    notes:
      '验 sendMessage 的 wrap—— PUT keepalive 在第一次 sendMessage 同步 push user msg 后立刻发，' +
      '即使 stream 没完成 user input 也得活着。',
  },
  {
    id: 'chat-history-empty-state-reload',
    name: 'H-3: Empty chat reload — fresh project shows empty state, not loading/error',
    automated: true,
    notes:
      '刚创建 project、没发任何消息 → reload → ChatPanel scroll 区可见 + 没有任何 chat-msg-* 节点。',
  },

  // ───── 文件持久化（F-*） ─────
  {
    id: 'files-reload-content-preserved',
    name: 'F-1: File written during chat is still in tree + content matches after reload',
    automated: true,
    notes:
      '验 PUT /files/:path → R2 落盘 → GET /files 列出 → reload → 文件还在 + GET 内容字字符 match。',
  },
  {
    id: 'files-tree-active-tab-after-reload',
    name: 'F-2: After reload landing on Design Files tab, file tree shows the file (auto-pick behavior)',
    automated: true,
    notes:
      '记录现行 auto-pick 行为：reload 后第一次进项目仍 auto-pick entry → activeTab=Preview。' +
      '验文件树切回 Design Files tab 时该文件可见 + isActive 状态合理。',
  },

  // ───── 多项目（M-*） ─────
  {
    id: 'home-shows-existing-projects',
    name: 'M-1: Home displays existing projects from API in createdAt desc order',
    automated: true,
    notes:
      '通过 page.request.post /api/projects 创建 3 个 project → goto Home → 验 project-list ' +
      '含 3 项 + 顺序为 createdAt desc（最新创建在最前）。',
  },
  {
    id: 'home-click-opens-existing-project',
    name: 'M-2: Click an existing project on Home → navigates to /p/:id with state restored',
    automated: true,
    notes:
      '前置 mock 写 App.jsx + persist messages → 关 page → 进 Home → 点击 project-item → ' +
      '验 URL 跳到 /p/:id + workspace mount + chat history + file tree 都恢复。',
  },
  {
    id: 'multi-project-files-isolated',
    name: 'M-3: Two projects each with their own files — switching does not leak files between them',
    automated: true,
    notes:
      'P1 写 A.jsx；P2 写 B.jsx；切到 P1 → 只看到 A.jsx（B.jsx 不在）；切到 P2 → 只看到 B.jsx。',
  },

  // ───── 错误路径（ER-*） ─────
  {
    id: 'error-project-not-found',
    name: 'ER-1: Direct navigation to /p/<unknown> shows clear not-found UI',
    automated: true,
    notes:
      '验 Workspace 在 GET /api/projects/:id 返 404 时表现：是否显示明确错误状态 + 回 Home 入口。' +
      '现行 fallback 是 "<id> (offline)" → 期待 SUSPECTED BUG（用户无法分辨"项目不存在" vs "网络抖"）。',
  },
  {
    id: 'error-home-projects-api-5xx',
    name: 'ER-2: Home GET /api/projects 5xx → shows error state, not silent empty list',
    automated: true,
    notes:
      'page.route 拦 GET /api/projects 返 500 → goto Home → 验 ErrorBanner 可见 ' +
      '+ project-list-empty 不可见（防止 5xx 被误判为"无项目"）。',
  },
];

export function automatedPersistenceCases(): CaseEntry[] {
  return persistenceCases.filter((c) => c.automated);
}
