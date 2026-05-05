// Error / boundary cases.
//
// 不能放在 cases/index.ts —— 主 spec 用同一个 mock & BYOK 注入做 happy
// path，这里每条 case 自己 setup（不同的 BYOK 状态、不同的 mock 行为、
// 不同的 worker route 拦截）。spec 文件 `specs/error-paths.spec.ts` 按 id
// 分流断言块。
//
// 生产级测试规范：每个外部边界 (fetch / SDK / postMessage) 都要明确错误
// 状态 UI，不能空白 / 卡死 / 无限 loading。这里覆盖三类：
// BYOK 缺失 / 错配、worker 5xx、chat SDK 错误，外加 input 边界。

export interface ErrorCaseEntry {
  id: string;
  name: string;
  /** 始终 true —— 错误路径必须 automated（不接受 automated:false）。 */
  automated: true;
  notes?: string;
}

export const errorCases: ErrorCaseEntry[] = [
  // ───── BYOK 缺失 / 错配 ─────
  {
    id: 'byok-missing-shows-prompt',
    name: 'No BYOK: Home shows "Set API key" affordance + send is gated',
    automated: true,
    notes: '首屏没注 BYOK；验明确提示 + send 被 gate（要么 disable，要么开 modal）',
  },
  {
    id: 'byok-empty-string-blocks-send',
    name: 'BYOK = "": send is gated (treated as missing)',
    automated: true,
    notes: '空字符串 != 已设；ChatPanel 应该把它当 missing 处理，弹 modal 而不是 silently 发请求',
  },
  {
    id: 'byok-malformed-key-shows-401',
    name: 'BYOK = "invalid": send → OpenRouter 401 → ChatPanel error UI',
    automated: true,
    notes:
      '注个长度合法但 OpenRouter 返 401 的 key；mock 返 401 body；验 error banner 出现 + 不是无限 thinking',
  },

  // ───── Worker 错误 ─────
  {
    id: 'worker-create-project-5xx',
    name: 'POST /api/projects 5xx → Home shows error, no navigate',
    automated: true,
    notes: 'Home 创建 project 时 worker 返 500；验 createError banner + URL 仍在 / 不跳 /p/:id',
  },
  {
    id: 'worker-list-files-5xx',
    name: 'GET /api/projects/:id/files 5xx → file tree shows error, not infinite loading',
    automated: true,
    notes: '进 workspace 时 files endpoint 挂；验 file-tree-error 出现 + 没有死转圈',
  },
  {
    id: 'worker-write-file-5xx-during-tool',
    name: 'PUT /api/.../files/:path 5xx during chat tool exec → tool fails, chat survives',
    automated: true,
    notes: 'mock 触发 write_file，worker 拦返 500；验 tool 错误 badge + 流不卡死 + 用户能再发',
  },

  // ───── Chat / SDK 错误路径 ─────
  {
    id: 'chat-openrouter-4xx',
    name: 'OpenRouter returns 400 → ChatPanel shows error banner, not infinite thinking',
    automated: true,
    notes: 'mock 直接 overrideStatus=400；验 error banner 出现 + Atelier is thinking 消失',
  },
  {
    id: 'chat-openrouter-mid-stream-cut',
    name: 'OpenRouter SSE cut mid-stream → chat surfaces error + user can resend',
    automated: true,
    notes: 'mock body 半截 close（cutAfterChunks=1，缺 [DONE]）；验 error 出现 + send 重新可点',
  },
  {
    id: 'chat-abort-stops-stream',
    name: 'Abort during slow stream → flow returns to ready, can send again',
    automated: true,
    notes:
      'mock streamSlowMs=3000，user 点 Stop；验 status 回 ready + send 又可点。无 abort UI 标 SUSPECTED BUG',
  },

  // ───── 输入边界 ─────
  {
    id: 'input-empty-prompt-disabled',
    name: 'Empty composer: Send is disabled, no fetch fired',
    automated: true,
    notes: '输入空白 click Send；验 button disabled + 没发 OpenRouter 请求',
  },
  {
    id: 'input-very-long-prompt',
    name: '10K+ char prompt: send still works, UI not frozen',
    automated: true,
    notes: 'composer fill 12000 char + Send；验请求发出 + UI 仍响应',
  },

  // ───── P1-7 fix: comments hydration failure ─────
  {
    id: 'worker-list-comments-5xx',
    name: 'GET /api/projects/:id/comments 5xx → CommentsTab shows error notice, not "No comments yet"',
    automated: true,
    notes:
      '拦 worker GET /comments 返 500；进 Comments tab 验 role=alert + degraded copy + 不是 cheerful 空态',
  },

  // ───── 错误覆盖缺口（之前没测过的 worker 路径） ─────
  {
    id: 'worker-get-project-by-id-5xx',
    name: 'GET /api/projects/:id 5xx → Workspace shows error UI, not blank shell',
    automated: true,
    notes:
      '直接 navigate 到 /p/:id 但 worker 返 500；验明确错误 UI（不是空白 + 不是误导性的 "(offline)" 标签）',
  },
  {
    id: 'worker-put-messages-5xx',
    name: 'PUT /api/projects/:id/messages 5xx during chat → 不能静默失败',
    automated: true,
    notes:
      '触发 chat 流（user message + assistant 回复），worker PUT /messages 返 500；验：UI 有任何错误反馈（toast / badge / inline error）。如果当前完全静默，标 SUSPECTED BUG',
  },
  {
    id: 'worker-delete-project-5xx',
    name: 'DELETE /api/projects/:id 5xx → 用户感知到删除失败',
    automated: true,
    notes:
      '从 Home 触发 delete project（需 UI 找到 delete affordance；如果不存在标 SUSPECTED BUG project 没有 delete UI），mock worker 返 500；验错误 UI + project 仍在列表',
  },
];

export function automatedErrorCases(): ErrorCaseEntry[] {
  return errorCases.filter((c) => c.automated);
}
