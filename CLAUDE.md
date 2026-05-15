# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 本仓库使用中文对话。
> `AGENTS.md` 必须保持为指向本文件的软链接；只更新 `CLAUDE.md`，不要维护两份内容。

## 项目简介

**Open Claude Design / Open Design** 是一个纯 Web 的 chat-driven 多文件 React prototype 工作台：用户用自然语言对话，让浏览器侧 agent 直接生成可运行、可交互的项目；右侧 iframe 实时预览，并提供四个就地工具：

- **Tweaks**：artifact 内嵌 `EDITMODE` 块，自声明可调 token；artifact 自己渲染 Tweaks UI，host 只负责激活和持久化 `__edit_mode_set_keys`
- **Comment**：在预览元素上点 pin 写评论，pin 持久化到 worker，并可作为上下文发回 chat
- **Edit**：点任意元素，浮窗里改样式；优先回写 Tailwind class，不能安全映射时回写 inline style
- **Draw**：在预览上画线 / 点击标注，截图 + 备注作为下一条 chat 输入

## 质量基线

不接受 happy-path-only。每条用户路径必须覆盖：

- unit + integration + e2e 三层测试，包含错误 / 边界 / abort / reload / 持久化 case
- 外部边界（fetch / postMessage / iframe / SDK / D1 / R2）的明确错误状态 UI
- a11y：键盘可达、aria 标签、loading / empty / hover / error 状态
- bug 修复必须先讲清 root cause，并优先补能失败的测试；不要用绕过式 patch

UI 改动交付前必须用 headless Chrome 跑核心路径（navigate + click + screenshot）。`typecheck` / unit test 过不等于 UI 跑通。

## 常用命令

环境：`.nvmrc` 和 CI 使用 Node 22；根 `package.json` 允许 Node `>=20`，npm 版本锁在 `npm@10.9.0`。

```bash
# 一次性初始化（npm install + 本地 D1 schema）
npm run setup

# 开发（Turbo 同时起 web 5173 + api 8787）
npm run dev

# 单独起其中一个
npm run dev --workspace=@open-design/web
npm run dev --workspace=@open-design/api

# CI build job 同款
npm run format:check
npm run typecheck
npm run lint
npm run test:coverage
npm run test:integration
npm run build

# E2E job 同款
npm run test:e2e
npm run test:e2e:headed

# 自动修
npm run format
```

**单个 package 测试**：`npm test --workspace=@open-design/web`
**单个测试文件**：`cd apps/web && npx vitest run path/to/file.test.ts`
**watch 模式**：`npm run test:watch --workspace=@open-design/web`
**API 集成测试**：`npm run test:integration --workspace=@open-design/api`

本地 API 说明：

- Vite dev server 把 `/api/*` proxy 到 `http://localhost:8787`
- `apps/api/.dev.vars.example` 当前没有必填 secret；本地 D1/R2 走 Wrangler local state
- `apps/api/wrangler.toml` 的 `database_id = "TODO_FILL_AFTER_CREATE"` 本地 dev 不需要替换；远端部署前跑 `npm run cf:provision`
- `ALLOWED_ORIGINS` 默认是 `http://localhost:5173`；跨域部署时改 worker vars
- Web 端可用 `VITE_API_BASE` 指向异源 worker；`VITE_VENDOR_RUNTIME=true` 会让 iframe runtime 从同源 `/vendor` 读 React/Babel，需先 `npm run vendor --workspace=@open-design/web`

## 仓库架构

npm workspaces + Turbo monorepo。

```text
apps/
  web/              Vite + React 18.3.1 + RR v6 + styled-components — 主 SPA
    src/features/
      chat/         ToolLoopAgent、useChat、tools、system prompt、verifier
      preview/      iframe bridge + Tweaks/Comment/Edit/Draw
      workspace/    Header、FileTree、FileSourceView、Toolbar、ChatTabBar
      home/         项目列表、创建流、examples、zip import
      settings/     BYOK key modal/form
  api/              Hono on Cloudflare Workers + D1 + R2 — 存储 REST API
packages/
  contracts/        前后端共享 HTTP API 契约、provider/model 列表
  design-tokens/    color / typography token（TS + CSS 双源）
  iframe-runtime/   注入预览 iframe 的 srcdoc、overlay、Tweaks bridge
e2e/                Playwright 端到端套件 + OpenRouter mock/BYOK fixtures
```

## 关键架构事实

### Agent / Chat

**Agent loop 在浏览器侧跑，不在 worker。** 实现位于 `apps/web/src/features/chat/`：

- `agent.ts` 创建 Vercel AI SDK `ToolLoopAgent`
- `use-agent-chat.ts` 用 `@ai-sdk/react` 的 `useChat` + `DirectChatTransport`
- 没有 `/api/chat` 端点；如果 `useChat` 回退到默认 HTTP transport，会 POST `/api/chat` 然后 404，这是 bug
- system prompt 在 `apps/web/src/features/chat/system-prompt/`
- 内置 skills 从 `apps/web/src/skills/built-in/**/SKILL.md` 通过 Vite glob 注册

BYOK 是多 provider 的：

- provider / model 单一来源在 `packages/contracts/src/chat.ts` 的 `PROVIDERS` / `MODELS`
- 当前选择存在 localStorage：`open-design.provider`、`open-design.model`
- 每个 provider 的 key 单独存在 localStorage：`open-design:llm-api-key:<provider>`
- worker 永远不接触 LLM key、system prompt 或工具定义

当前工具定义在 `apps/web/src/features/chat/tools/`，工具名是协议面，默认不要改：

- 文件：`write_file`、`read_file`、`list_files`、`str_replace_based_edit_tool`、`delete_file`、`copy_files`、`grep`
- 辅助：`view_image`、`web_fetch`、`invoke_skill`、`update_todos`、`done`
- verifier：`fork_verifier_agent`、`verification_feedback`

多 chat 已实装。`WorkspaceProvider` 持有 `chats` / `activeChatId`；每条 chat 的 messages 由 `useChat` 持有，并通过 `GET/PUT /api/projects/:id/messages?chatId=...` 按整条 thread 替换持久化。新 chat 先是前端 `isPending` placeholder，用户第一次发送前才 POST `/chats` materialize。

Verifier 子 agent 已实装：`fork_verifier_agent` 输出只作为信号；`useAgentChat` 看到对应 tool part 后调用 `spawnVerifier()`。verifier chat id 必须是 `<main session id>::verifier`，继承主消息历史，通过 `verification_feedback` 退出，默认 60s timeout。

### Worker / Storage

`apps/api` 是存储型 REST API，不参与 chat path。路由挂载在 `apps/api/src/index.ts`：

- `GET /health`
- `GET/POST /api/projects`
- `GET/PATCH/DELETE /api/projects/:id`
- `GET /api/projects/:id/files`
- `GET/PUT/DELETE /api/projects/:id/files/:filePath`
- `POST /api/projects/:projectId/files/copy`
- `POST /api/projects/:projectId/grep`
- `GET/POST /api/projects/:id/chats`
- `PATCH/DELETE /api/projects/:id/chats/:chatId`
- `GET /api/projects/:id/messages?chatId=...`
- `PUT /api/projects/:id/messages`
- `GET/POST /api/projects/:id/comments`
- `DELETE /api/projects/:id/comments/:commentId`
- `GET /api/util/fetch?url=...`

当前没有 mounted `/api/share/:token` 或 `/api/projects/:id/share-link` 路由；`shares` 表/类型是遗留或未来占位，文档和 UI 不要把 share 当成可用功能，除非先补 route + tests。

存储模型：

- D1：`projects`、`blobs`、`files`、`chats`、`messages`、`comments`，以及目前未挂路由的 `shares`
- R2：sha256 内容寻址 blob；`files` 表只保存 project/path 到 sha256 的当前指针
- `messages.data` 存完整 Vercel AI SDK `UIMessage` JSON，worker 只抽 `id` / `role` / `position` 建索引
- 文件 MIME 有 allowlist，改 `FileMimeType` 时同步 `ALLOWED_FILE_MIME_TYPES` 和 worker 推断逻辑

### Preview / Iframe Runtime

iframe runtime 在 `packages/iframe-runtime`。React **18.3.1**、ReactDOM **18.3.1**、Babel Standalone **7.29.0** 版本号锁死在 `build-srcdoc.ts`，不要擅自升级。

预览构建有两条路径：

- `buildSrcdoc()`：多文件 React/JSX bundle，拼成单个 Babel script；会 strip `import/export`、注入 React globals prelude、过滤二进制文件、注入 Tailwind Play CDN 和 Google Fonts
- `buildHtmlSrcdoc()`：HTML entry 直接作为 srcdoc；注入 `<base href="/api/projects/:id/files/">`、React globals prelude 和 overlay

入口选择在 `PreviewPanel.tsx`：

1. 用户显式选中 `.html/.htm` 文件时，直接走 HTML srcdoc
2. 项目只有 HTML、没有 JS/TS/JSX/TSX 时，用 `pickHtmlEntry()`：`index.html` > `app.html` > 字典序第一个 HTML
3. 其他情况走 React bundle，不要简单理解成“永远 `.html` 优先”

四个工具的边界：

- Tweaks 完全 artifact-driven；host 没有 fallback slider 面板
- Comment/Edit 的元素选择来自 iframe overlay 的 `ELEMENT_SELECTED`
- Edit 先尝试 Tailwind className AST 回写，失败才写 inline style；离开 Edit mode 时 flush
- Draw 截图用 `html-to-image`，截图失败时仍发送文本请求
- iframe 内的 `window.claude.complete(prompt)` 通过 `CLAUDE_COMPLETE*` postMessage 让 host 用当前 provider 的 fast model 流式返回，worker 不参与

### Frontend State

`apps/web/src/state/workspace.tsx` 是工作区 UI 状态的单一 reducer/context。Action union 必须先在 `apps/web/src/state/types.ts` 显式扩展，再实现 reducer 分支。不要引入 Redux / Zustand / Jotai。

注意：chat messages 不在 workspace state；它们由 `useChat` 管理，并持久化到 `/messages`。workspace 只持有 active chat、pins、tool、draw strokes、tabs、zoom、pending chat submit 等 UI 协调状态。

路由在 `apps/web/src/App.tsx`：

- `/`：Home
- `/p/:id`：Workspace
- `/p/:id/present`：无 chrome 全屏 preview
- 没有 `/settings` 页面；设置通过 Home/Workspace 里的 modal 打开
- 没有 `/share/:token` 页面

## 协议字面量（不可擅改）

这些字面量与已有 artifact / 测试 fixture / 导入导出兼容性相关，改之前先问一次，并同步 unit + e2e：

- overlay postMessage：`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `CLEAR_PIN` / `OVERLAY_READY` / `IFRAME_ERROR`
- `window.claude.complete()` RPC：`CLAUDE_COMPLETE` / `CLAUDE_COMPLETE_CHUNK` / `CLAUDE_COMPLETE_DONE` / `CLAUDE_COMPLETE_ERROR`
- Tweaks 协议：`__edit_mode_available` / `__activate_edit_mode` / `__deactivate_edit_mode` / `__edit_mode_set_keys`
- EDITMODE markers：`/*EDITMODE-BEGIN*/` / `/*EDITMODE-END*/`
- selector 稳定属性：`data-codesign-id`
- verifier：`fork_verifier_agent` / `verification_feedback` / `<uuid>::verifier`

postMessage / EDITMODE 的类型来源主要在 `packages/iframe-runtime/src/editmode-protocol.ts`、`overlay.ts`、`tweaks-bridge.ts`；HTTP API / provider-model 契约来源在 `packages/contracts/src/`。不要再把所有协议都归到 `packages/contracts`。

## 工作约定

1. **修代码 ≠ 改协议**：postMessage、EDITMODE、工具名、`<uuid>::verifier` 默认保留字面量
2. **运行时锁死**：iframe 内 React/Babel 版本和 CDN 路径不要擅自升；生产 vendor 走 `npm run vendor --workspace=@open-design/web`
3. **前端 reducer 严格 TS union**：新交互先扩 `state/types.ts` action，再改 reducer
4. **REST 路由要配 contracts + tests**：新增/改路由时同步 `packages/contracts/src/*`、API route tests、前端 api tests
5. **UI 改动必须实跑**：至少 headless Chrome 打开相关页面，完成核心 click / submit / screenshot 路径
6. **`AGENTS.md` 是软链接**：不要把它改成独立文件；内容更新只改 `CLAUDE.md`
