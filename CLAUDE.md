# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本仓库使用中文对话。

## 项目简介

**Open Design** 是一个 chat-driven 的多文件 React prototype 工作台：用户用自然语言对话，让 AI 直接生成可运行、可交互的 React 项目；右侧 iframe 实时预览，外加四个交互工具：

- **Tweaks**：artifact 内嵌的 EDITMODE 块定义可调 token，UI 滑杆 / 颜色拣选实时改设计 token
- **Comment**：在预览上点 pin 写评论，把上下文喂给 AI 改写
- **Edit**：点任意元素，浮窗里改 inline 样式
- **Draw**：在预览上画线 + 截图给 AI 让它按草图改

## 质量基线

不接受 happy-path-only。每条用户路径必须有：

- unit + integration + e2e 三层覆盖（错误 / 边界 / abort / reload / 持久化 case）
- 外部边界（fetch / postMessage / iframe / SDK）的明确错误状态 UI
- a11y（键盘可达 / aria 标签 / loading / empty / hover）
- bug 修复必须 root cause + TDD failing test 先行，不接受 patch 绕过

UI 改动在交付前**必须**用 headless Chrome 实跑核心路径（navigate + click + screenshot）—— typecheck / unit test 过 ≠ UI 跑通。

## 常用命令

环境：Node 22（见 `.nvmrc`），npm 10+。CI 走 `.github/workflows/ci.yml`，跑 format-check / typecheck / lint / test / build 全套。

```bash
# 一次性初始化（npm install + 应用本地 D1 schema）
npm run setup

# 开发（同时起 web 5173 + api 8787）
npm run dev

# 单独起其中一个
npm run dev --workspace=@open-design/web
npm run dev --workspace=@open-design/api

# CI 套件（每条都通过才能 push）
npm run format:check    # prettier --check
npm run typecheck       # turbo run typecheck（每个 package 跑 tsc --noEmit）
npm run lint            # turbo run lint（每个 package 跑 eslint --max-warnings 0）
npm test                # turbo run test（vitest，无 test 文件时 passWithNoTests）
npm run build           # turbo run build

# 自动修
npm run format          # prettier --write
```

**单个 package 跑测试**：`npm test --workspace=@open-design/web`
**单个测试文件**：`cd apps/web && npx vitest run path/to/file.test.ts`
**watch 模式**：`npm run test:watch --workspace=@open-design/web`

**API 本地依赖**：

- `apps/api/.dev.vars`（从 `.dev.vars.example` 拷），填 `SHARE_TOKEN_SECRET`
- `apps/api/wrangler.toml` 的 `database_id = "TODO_FILL_AFTER_CREATE"` 占位 —— 本地 dev 不需要替换；远端部署前必须 `wrangler d1 create open-design` 拿真 id
- 远端 schema：`npm run db:migrate:remote --workspace=@open-design/api`

## 仓库架构

npm workspaces + Turbo monorepo。

```
apps/
  web/              Vite + React 18.3.1 + RR v6 + styled-components — 主 SPA
  api/              Hono on Cloudflare Workers + D1 + R2 — 后端
packages/
  contracts/        前后端共享 TypeScript 类型契约（协议字面量单一来源）
  design-tokens/    暖色调 token（color/font/shadow/radius），TS + CSS 双源
  iframe-runtime/   注入预览 iframe 的 overlay + Tweaks bridge（零运行时依赖，纯字符串拼接）
e2e/                Playwright 端到端套件
```

## 关键架构事实

**Agent loop 在浏览器侧跑**（不是云端）。**实现方式**：用 **Vercel AI SDK**（`ai` + `@openrouter/ai-sdk-provider` + `@ai-sdk/react`）的 `ToolLoopAgent` + `useChat` + `DirectChatTransport`。**API key 走 BYOK**（用户粘贴 OpenRouter key 存 localStorage，浏览器 SDK 直连 `openrouter.ai`）。

`apps/api` 的角色：**仅文件存储 REST API** —— D1（项目元数据）+ R2（sha256 内容寻址 blob）。worker **不参与** chat path，**不持有** ANTHROPIC_API_KEY，**不知道** system prompt 或 tool 定义。

**工具执行**（`edit_file` / `read_file` / `list_files` / `mark_done`）由 Vercel AI SDK 在浏览器侧调起，tool execute 内部调 worker 的 REST API 把内容落盘到 R2/D1。tool 定义在 `apps/web/src/features/chat/tools/`（不在 worker）。

**入口文件**：iframe 渲染时按优先级选 entry 文件（HTML-first，`.html` > `.jsx`/`.tsx`）。`packages/iframe-runtime` 输出一个 srcdoc HTML 字符串，在 iframe 里跑 React 18.3.1 + Babel Standalone 7.29.0（unpkg CDN，可 vendor）。**这两个版本号不可以擅自升** —— 升了会让运行时和已有 artifact 行为分叉。版本常量在 [`packages/iframe-runtime/src/build-srcdoc.ts`](packages/iframe-runtime/src/build-srcdoc.ts) 顶部。

**API 路由是 REST 风格**（`/api/chat`、`/api/projects/:id/files/:path`、`/api/projects/:id/share-link`、`/api/share/:token`）。

**前端状态管理**：[`apps/web/src/state/workspace.tsx`](apps/web/src/state/workspace.tsx) 是单一的 `useReducer` + Context（`WorkspaceProvider` + `useWorkspace()`）。Action union 完整列在 [`state/types.ts`](apps/web/src/state/types.ts)，新加交互**先扩 action**再实现 reducer 分支。**前端不引入 Redux / Zustand / Jotai**。

## 协议字面量（不可擅改）

下列字符串字面量与 artifact / 用户已有产物的兼容性强相关，改之前**问一次**：

- **postMessage 类型**：`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `CLEAR_PIN` / `OVERLAY_READY` / `IFRAME_ERROR` / `__edit_mode_available` / `__activate_edit_mode` / `__deactivate_edit_mode` / `__edit_mode_set_keys`
- **Tweaks artifact 协议**：`/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/`
- **Sub-agent UUID 后缀**：`<uuid>::verifier`

[`packages/contracts/src/`](packages/contracts/src/) 是上述字面量的单一来源 —— 改这里 = 改协议 = 大概率你不该这么做。

## 工作约定

1. **修代码 ≠ 改协议**：postMessage / EDITMODE / `<uuid>::verifier` 默认保留字面量；改之前问一次
2. **生成产物运行时锁死**：iframe 里跑的 React + Babel 版本号 + SRI integrity 锁死，不能擅升
3. **前端 reducer 严格 TS union**：每个 action 必须在 `state/types.ts` 显式列出，禁止 ad-hoc dispatch
