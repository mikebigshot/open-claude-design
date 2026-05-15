# Open Claude Design

> **把 [Claude Design](https://claude.ai/design) 复刻成一个开源的纯 Web 应用。** Agent 驱动的原型设计工作台，配 **Tweaks · Comment · Edit · Draw** 四个就地预览工具。Agent 跑在你的浏览器 tab 里；一个 Cloudflare Worker（D1 + R2）负责存文件。没有 Electron、没有本地 daemon、没有服务端 LLM 代理。

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Status" src="https://img.shields.io/badge/状态-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/技术栈-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#本地开发"><img alt="本地开发" src="https://img.shields.io/badge/本地开发-复制粘贴一段-green?style=flat-square" /></a>
  <a href="#cloudflare-自部署"><img alt="自部署" src="https://img.shields.io/badge/自部署-复制粘贴一段-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

<p align="center">作者：<a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **状态：pre-alpha。** 架构已经稳定，四个预览工具端到端跑通，但 wire 协议在任意 release 都可能出现 breaking change。如果你依赖协议字面量，请锁版本。

## 为什么有这个项目

Anthropic 的 [Claude Design](https://claude.ai/design) 把 LLM 变成了一个交付可交互设计成品的工具：chat 进、多文件 React 原型出、随手改任意元素、ship。它瞬间出圈，然后保持**闭源**、付费、只跑在云上、绑死 Anthropic 的栈。

**Open Claude Design 是这套表面的一份开源忠实复刻，技术骨架对齐官方实现。** 在每个有取舍的地方，我们都优先参考 Anthropic 实际发出来的东西 —— artifact 格式、`EDITMODE` Tweaks 块、`<uuid>::verifier` 子 agent 命名约定、iframe 内的 Babel Standalone 渲染、四个工具的 `postMessage` 语法（`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …）。这份代码最大的单一输入源，就是去读懂 Anthropic 已经上线的运行时。

**跟 Claude Design 一样，agent loop 留在浏览器 tab 里，chat / 文件 / 项目状态同步到自己的后端。** 这是我们与原版最关键的同构点 —— Anthropic 在云端只做 LLM 透传 + 工具执行 + 项目快照存储，agent 循环本体跑在浏览器 SPA 里；我们用 [Vercel AI SDK](https://github.com/vercel/ai) 的 tool loop 同样跑在浏览器 tab，chat / 文件 / 项目状态走 Cloudflare Worker 落到 D1 + R2，Worker 永远看不到你的 prompt。这套 **web agent + 后端存储**的形态，也是最适合演进成 SaaS 的。

## 技术架构

> 这一节是这套代码的隐性 spec。结论来自我们 2026-04 期间对 `claude.ai/design` 的真实登录态调研 —— DOM / 网络抓包 / 全局变量 / 真实下载产物 / 反混淆 runtime / 实测 POC，尽量只列直接观察到的事实。

### 原版 Claude Design 长什么样

浏览器是 agent 的宿主，云端只是 LLM 网关 + 工具后端。一个 turn 的 Chat 请求体直接是 Anthropic Messages API 透传（含完整 system + tools + 全部 messages，由浏览器侧组装），云端 `OmeletteService` **不维护对话状态**，只做 LLM 透传 + 工具执行 + 项目快照存储。

```text
浏览器 SPA（Vite + React Router v6 + styled-components）
├── 主 agent loop                          ← agent 真正的宿主
│     while (not done):
│       POST OmeletteService.Chat (Anthropic Messages API 透传)
│       parse tool_use → 9 类执行端
├── Verifier 子 agent（UUID::verifier）     ← FORK BOUNDARY 角色注入
├── 预览 iframe（*.claudeusercontent.com） ← srcdoc + runtime 注入 + postMessage RPC
└── 本地文件夹桥（File System Access API） ← 4 个 local_* 工具走浏览器原生 API
                ↓ Connect / gRPC-Web + Protobuf
OmeletteService（thin LLM proxy + 工具后端）
   Chat              → api.anthropic.com 透传
   EditFile / GetFile / ListFiles / RecordAsset → 项目沙箱 CRUD
   UpdateProjectData → 客户端权威状态整快照
   McpListTools      → 第三方 MCP server 工具发现
   MintPreviewToken  → preview 短期签名
```

#### 关键观察

| 维度              | 实际实现                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主 app 前端栈     | Vite + React Router v6 + styled-components；代码编辑器是原生 `<textarea>` + 手写 `<div>` 行号，无 Monaco / CodeMirror                                                                                                                 |
| 后端协议          | Connect / gRPC-Web + Protobuf；Service 名 `anthropic.omelette.api.v1alpha.OmeletteService`                                                                                                                                            |
| Agent 工具协议    | MCP（Model Context Protocol）—— 抓到完整 `tools/list` 数据 + `defer_loading` 字段，第三方 MCP server 真实可接入                                                                                                                       |
| 工具路由          | 30+ 工具按 9 类分发：云端 RPC（EditFile / GetFile / …）/ 本地 FSA（local\_\*）/ iframe DOM（show_html / eval_js / screenshot）/ 客户端纯逻辑（snip / update_todos）/ 派生 sub-agent / 第三方 MCP / LLM 内置（web_search / web_fetch） |
| Verifier 子 agent | 跟主 agent **共享 system prompt + 共享工具集 + 共享 history**，仅靠在 fork tool_result 里塞角色重置 prompt + sessionUUID 追加 `::verifier` 后缀 + max_tokens 砍半实现                                                                 |
| 预览 iframe       | 每个项目独立子域 `{project-uuid}.claudeusercontent.com`；主站 CSP `default-src 'none'; frame-ancestors 'none'`；token 4 段：`{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}`                                                  |
| 生成产物运行时    | React **18.3.1** + Babel Standalone **7.29.0**（UMD，integrity hash 锁死）+ 内联 `style={{...}}` JS 对象 + Google Fonts + 多 JSX `<script type="text/babel" src="*.jsx">` 全局 window 挂载                                            |
| Tweaks 协议       | artifact 内嵌 `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` + `EDIT_STYLE` postMessage 实时回写，不重跑模型                                                                                                                              |
| 客户端权威存储    | 浏览器持有完整 chats / messages / contentBlocks / 工具 IO / viewState / assets manifest，定期通过 `UpdateProjectData` 整包推回云端；**每个 tool call 的 input/output 都被持久化**                                                     |
| `done` 复合操作   | EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData 一连串触发                                                                                                                                                           |
| Streaming         | 不是 Anthropic 原生 SSE，OmeletteService 重新封装为 `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` 自定义帧                                                                            |
| 本地文件夹桥      | File System Access API + 4 个 `local_*` 工具（local_ls / local_read / local_grep / local_copy_to_project）；本地文件**不传** OmeletteService，只在 LLM 上下文里出现                                                                   |

### Open Claude Design 长什么样

我们把上面那张图原样搬过来：agent loop 留在浏览器，云端只做存储。整体形态对齐，只在工程取舍上简化（HTTP REST 替 Connect / gRPC-Web、Cloudflare Worker 替自研后端、BYOK 替托管 key）。

```text
浏览器 SPA（Vite + React 18.3.1 + React Router v6 + styled-components）
├── 主 agent loop                          ← ToolLoopAgent（Vercel AI SDK）
│     while (not done):
│       streamText({ system, tools, messages, model })  ← 浏览器侧组装 + 直连 LLM
│       parse tool_use → 浏览器侧 execute
├── tools（apps/web/src/features/chat/tools/）
│     edit_file / read_file / list_files / mark_done
│     ↓ tool execute 内部 fetch worker REST
├── 预览 iframe（srcdoc 装载）              ← React 18.3.1 + Babel Standalone 7.29.0
│     postMessage RPC：SET_MODE / EDIT_STYLE /
│     ELEMENT_SELECTED / OVERLAY_READY / IFRAME_ERROR
└── Tweaks / Comment / Edit / Draw 四个浮层工具
                ↓ HTTP REST + SSE（schema 锁在 packages/contracts）
Cloudflare Worker（apps/api，Hono — 不参与 chat path，仅文件存储）
   /api/projects/:id/files/:path  → D1 + R2 CRUD
   /api/projects/:id/share-link   → 短期签名链接
   /api/share/:token              → 公共预览
   ├── D1（SQLite）：项目元数据 + 文件路径 → content_hash 映射
   └── R2：sha256 内容寻址 blob

LLM provider（用户 BYOK，浏览器直连，worker 看不见）
   openrouter.ai 或任意 OpenAI 兼容端点
```

#### 沿用了哪些

- **浏览器侧 agent loop** —— Vercel AI SDK 的 `ToolLoopAgent` 在 tab 里跑（原版用什么 agent 框架未公开，但 loop 宿主同位）
- **客户端权威 + 后端整快照** —— D1 存项目元数据 + R2 存 sha256 内容寻址 blob，整包写入
- **预览 iframe 的运行时栈** —— React 18.3.1 + Babel Standalone 7.29.0 同版本同 integrity，多 JSX 入口同语义
- **协议字面量** —— Tweaks 的 `EDITMODE-BEGIN/END`、`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` 等 postMessage 类型、`<uuid>::verifier` 子 agent 命名约定，全部保留

#### 主动偏离的地方

- **Wire 协议** 从 Connect / gRPC-Web 简化到 HTTP REST + SSE（schema 锁在 [`packages/contracts`](packages/contracts/)，`.proto` 没复用）
- **字体** 从商业 Anthropic Serif 换成 Google Fonts（Inter / Instrument Serif / JetBrains Mono），图标用 Lucide
- **预览子域** 从 `*.claudeusercontent.com` 换成 Cloudflare Pages 默认子域（自部署可绑域）
- **本地文件桥 / 第三方 MCP / verifier 子 agent** 暂未实装（roadmap）

## 跟 nexu-io/open-design、OpenCoworkAI/open-codesign 的区别

三个项目都是 Claude Design 的开源复刻，差异主要在 **agent loop 跑在哪、chat / 文件落在哪**。

|                             | Claude Design（原版）                   | [open-codesign][ocod]               | [nexu-io/open-design][nexu]                               | **Open Claude Design**                              |
| --------------------------- | --------------------------------------- | ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| 形态                        | Web (claude.ai)                         | Desktop (Electron)                  | Web app + 本地 daemon                                     | **纯 Web + Cloudflare Workers**                     |
| Agent loop 跑在哪           | 浏览器 tab                              | Electron 主进程内捆绑 [pi-ai]       | 用户已装的 CLI（Codex / Cursor / Gemini / … 13 个适配器） | **浏览器 tab（Vercel AI SDK ToolLoopAgent，BYOK）** |
| Chat / 文件落在哪           | 云端（OmeletteService + 内容寻址 blob） | 本地 SQLite + 本地文件系统          | 本地 SQLite + 本地文件系统                                | **Cloudflare D1 + R2（你自己的账号）**              |
| 是否需要本地装 CLI / 桌面壳 | 不需要                                  | 需要（Electron 安装包）             | 需要（npm + 13 个 CLI 之一）                              | **不需要 —— 浏览器开网页就能用**                    |
| 跟原版的同构度              | 100%                                    | 中（agent 在桌面 runtime 而非 web） | 中（agent 在用户 CLI，靠 daemon spawn）                   | **高 —— 浏览器跑 agent + 后端只做存储，跟原版同位** |
| License                     | 闭源                                    | MIT                                 | Apache-2.0                                                | Apache-2.0                                          |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

简言之：**open-codesign / nexu-io 是 local-first（agent 在桌面或用户 CLI、文件在本地）；我们和原版 Claude Design 一样是 web-first（agent 在浏览器、文件在云端后端）**。三种形态各有取舍 —— 我们这一版选了跟 Anthropic 已上线产品最同构的那条路线。

## 致谢

这个项目站在很多人的工作之上。

**[Anthropic 的 Claude Design](https://claude.ai/design)** 是 Open Claude Design 想复刻的产品。原作团队做出来的东西、立下的那条线，令我们由衷敬重 —— 每一层体验里都能看出他们花了多少心思。这份代码就是不断向那条线靠拢的过程。

我们也想感谢同方向的另外两个开源项目：

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) —— 感谢他们在这个方向上投入了扎实、考虑周全的开源工程。
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) —— 感谢他们把对同一问题的开源实现坦诚地公开发了出来。

它们让"开源复刻"这件事的讨论变得更丰富，我们由衷感谢这两个项目存在。

### 工具链

- [Vercel AI SDK](https://github.com/vercel/ai) —— 多 provider 抽象，让 agent 循环能在浏览器 tab 里跑。
- [React](https://react.dev/) 与 [Babel](https://babeljs.io/) —— UMD 构建撑起浏览器内的预览运行时。
- [Cloudflare Workers](https://workers.cloudflare.com/)、[D1](https://developers.cloudflare.com/d1/) 与 [R2](https://developers.cloudflare.com/r2/) —— 无服务器后端。
- [Hono](https://hono.dev/)、[Vite](https://vitejs.dev/)、[Turbo](https://turbo.build/)，以及更广的 TypeScript / npm-workspaces 工具链。

## 免责声明

Open Claude Design 是社区主导的开源复刻项目。**本项目与 Anthropic 没有任何隶属、认可或赞助关系。** "Claude" 与 "Claude Design" 是 Anthropic, PBC 的商标。

Agent 的部分行为指引 —— 具体指 [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) 下的 system prompt 内容 —— 改编自对 Anthropic 已上线 Claude Design 运行时的观察。我们以「fair use / 互操作性」为由保留这部分内容，以让开源复刻尽量忠实于原作表面。

**若 Anthropic 团队希望我们移除或重写任何内容，我们会立即配合** —— 欢迎在 [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) 提 issue，或直接联系仓库维护者。

## 能做什么

- **Chat → 生成**：自然语言描述 → AI 流式生成多文件 React 原型，token 一边产出一边落到工作区。
- **Tweaks**：artifact 自声明的设计 token 变成实时滑杆 / 颜色拣选 —— 就地调，不重新 prompt。
- **Comment**：在预览的某个坐标点 pin 写评论，pin 上下文跟着回到 agent 做定向改写。
- **Edit**：点元素，浮动 inspector 里改 inline 样式或 Tailwind 类，改动落回源文件。
- **Draw**：在预览上手绘草图，笔迹 + 截图作为下一回合输入，模型据此改图。
- **多文件项目**（`.jsx` / `.html` / `.css`）通过 Babel Standalone 在沙盒 iframe 渲染 —— entry 文件按 `.html` > `.jsx`/`.tsx` 优先级解析。
- **可导入** —— 把 Claude Design 导出的 ZIP 拖进工作区，agent 接着 Anthropic 停下的地方继续编辑。

## 技术栈

- **前端** —— Vite + React 18.3.1 + React Router v6 + styled-components
- **后端** —— [Hono](https://hono.dev/) on Cloudflare Workers
- **存储** —— Cloudflare D1（元数据）+ R2（sha256 内容寻址 blob）
- **AI** —— [Vercel AI SDK](https://github.com/vercel/ai) `ToolLoopAgent` 跑在浏览器里，直接拿用户的 key 调 OpenRouter / 10 家一线 provider
- **Wire** —— HTTP REST + SSE，schema 锁在 [`packages/contracts`](packages/contracts/)
- **测试** —— Vitest（unit + integration）+ Playwright（e2e）

## 本地开发

**前置**：Node 22+，npm 10+。**不需要 Cloudflare 账号** —— `wrangler` 的 `--local` 模式跑的是 `.wrangler/state/` 下的本地 SQLite。

把下面整段复制到一个新终端：

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # 首次约 1 分钟：装依赖 + 应用 D1 migration
npm run dev      # web :5173，api :8787（Ctrl-C 停）
```

dev server 起来后打开 <http://localhost:5173>。第一次发 chat 会让你贴 OpenRouter API key —— 在 [openrouter.ai/keys](https://openrouter.ai/keys) 申请。Key 只存浏览器 `localStorage`；要清除或替换，访问 `/settings`。

后续启动只用跑 `npm run dev` 一条 —— `setup` 是一次性的。

> Sanity check：`curl http://localhost:8787/health` → `200 {"ok":true,...}`。

## Cloudflare 自部署

> 你出 Cloudflare 账号；你的用户出自己的 LLM key。

```bash
npm run cf:provision    # 一次性：wrangler login + 建 D1 / R2 + 应用 schema
npm run deploy          # 每次：部署 Worker（API） + Pages（SPA）
```

`npm run deploy` 跑完你会得到 `https://open-design-web.pages.dev`（SPA）+ `https://open-design-api.<your-subdomain>.workers.dev`（API）。

`cf:provision` 一次跑完：自动登录 Cloudflare（已登录就跳过）、创建 `open-design` D1 数据库并把 `database_id` 写回 [`apps/api/wrangler.toml`](apps/api/wrangler.toml)、创建 `open-design-blobs` R2 bucket、把 D1 schema 应用到远端。

`deploy` 一次跑完：部署 Worker、把 React + Babel UMD bundle vendor 到 `apps/web/public/vendor/`（让预览能离线 / 在内网 / 严格 CSP 下跑）、build SPA、推送到 Cloudflare Pages（项目 `open-design-web`）。

或者直接用内置的 GitHub Action —— push 到 `main` 触发 `.github/workflows/deploy.yml`，前提是你在仓库 secrets 里加了 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`（缺这两个时 workflow 会 no-op，所以 fork 仓库不会爆）。

## 仓库结构

```
open-claude-design/
├── apps/
│   ├── web/                — 前端（Vite + React + styled-components）
│   │   └── src/features/
│   │       ├── chat/       — 浏览器侧 ToolLoopAgent + tools + system prompts
│   │       ├── preview/    — Iframe + Tweaks/Comment/Edit/Draw 浮层
│   │       ├── workspace/  — 多 tab 文件工作区 + 项目状态
│   │       ├── home/       — 首页、项目选择器、示例画廊
│   │       └── settings/   — BYOK key 管理
│   └── api/                — 后端（Hono on Cloudflare Workers + D1 + R2）
├── packages/
│   ├── contracts/          — 前后端共享 TypeScript wire 契约（单一来源）
│   ├── design-tokens/      — color / typography token（TS + CSS 双源）
│   └── iframe-runtime/     — 注入 iframe 的 overlay + Tweaks bridge（零运行时依赖，纯字符串拼接）
└── e2e/                    — Playwright 端到端套件
```

## 贡献

欢迎 PR。项目 pre-alpha 阶段，贡献门槛宽松。

```bash
npm install
npm run typecheck   # 整个 workspace 跑 tsc --noEmit
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright（需要先 `npm run dev` 跑着）
```

分支策略、commit 约定、新人代码阅读路径见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[Apache License 2.0](LICENSE) —— fork、改、ship。
