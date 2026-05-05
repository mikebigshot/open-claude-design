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

<p align="center"><a href="README.md">English</a> · <b>简体中文</b> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">作者：<a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **状态：pre-alpha。** 架构已经稳定，四个预览工具端到端跑通，但 wire 协议在任意 release 都可能出现 breaking change。如果你依赖协议字面量，请锁版本。

## 为什么有这个项目

Anthropic 的 [Claude Design](https://claude.ai/design) 把 LLM 变成了一个交付可交互设计成品的工具：chat 进、多文件 React 原型出、随手改任意元素、ship。它瞬间出圈，然后保持**闭源**、付费、只跑在云上、绑死 Anthropic 的栈。

**Open Claude Design 是这套表面的一份开源忠实复刻，技术骨架对齐官方实现。** 在每个有取舍的地方，我们都优先参考 Anthropic 实际发出来的东西 —— artifact 格式、`EDITMODE` Tweaks 块、`<uuid>::verifier` 子 agent 命名约定、iframe 内的 Babel Standalone 渲染、四个工具的 `postMessage` 语法（`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …）。这份代码最大的单一输入源，就是去读懂 Anthropic 已经上线的运行时。

我们和 Claude Design 在一个方向上分流：**纯 Web，无外壳，不做 SaaS。** 整个产品跑在浏览器 tab + 一个 Cloudflare Worker。Chat agent（[Vercel AI SDK](https://github.com/vercel/ai) 的 tool-loop）**在你的浏览器 tab 里**执行，直接拿你的 key 调 OpenRouter —— Worker 只做存储，永远看不到你的 prompt。这个取舍换来三件事：

1. **免费 Cloudflare 账号一段命令自部署** —— 没有 Postgres、Redis、ECS、Docker。
2. **没有账号、没有共享 SaaS、没有配额** —— fork、deploy、把链接发给朋友。
3. **一份能读完的代码** —— 严格 TS、npm workspaces、约 10 个源码文件夹。最有意思的部分（iframe runtime、`EDITMODE` 协议、浏览器侧 agent 循环）一个周末读得完。

## 致谢

这个项目站在很多人的工作之上。

**[Anthropic 的 Claude Design](https://claude.ai/design)** 是 Open Claude Design 想复刻的产品。原作团队做出来的东西、立下的那条线，令我们由衷敬重 —— 每一层体验里都能看出他们花了多少心思。这份代码就是不断向那条线靠拢的过程。

我们也想感谢同方向的另外两个开源项目：

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) —— 感谢他们在这个方向上投入了扎实、考虑周全的开源工程。
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) —— 感谢他们把对同一问题的开源实现坦诚地公开发了出来。

它们让"开源复刻"这件事的讨论变得更丰富，我们由衷感谢这两个项目存在。

### 工具链

- [Vercel AI SDK](https://github.com/vercel/ai) —— 多 provider 抽象，让 agent 循环能在浏览器 tab 里跑。
- [OpenRouter](https://openrouter.ai/) —— 一把 BYOK key，通吃几十家 LLM provider。
- [React](https://react.dev/) 与 [Babel](https://babeljs.io/) —— UMD 构建撑起浏览器内的预览运行时。
- [Cloudflare Workers](https://workers.cloudflare.com/)、[D1](https://developers.cloudflare.com/d1/) 与 [R2](https://developers.cloudflare.com/r2/) —— 无服务器后端。
- [Hono](https://hono.dev/)、[Vite](https://vitejs.dev/)、[Turbo](https://turbo.build/)，以及更广的 TypeScript / npm-workspaces 工具链。

## 免责声明

Open Claude Design 是社区主导的开源复刻项目。**本项目与 Anthropic 没有任何隶属、认可或赞助关系。** "Claude" 与 "Claude Design" 是 Anthropic, PBC 的商标。

Agent 的部分行为指引 —— 具体指 [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) 下的 system prompt 内容 —— 改编自对 Anthropic 已上线 Claude Design 运行时的观察。我们以「fair use / 互操作性」为由保留这部分内容，以让开源复刻尽量忠实于原作表面。

**若 Anthropic 团队希望我们移除或重写任何内容，我们会立即配合** —— 欢迎在 [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) 提 issue，或直接联系仓库维护者。

## 一眼概览

| | 你拿到的 |
|---|---|
| **形态** | 纯 Web —— Vite SPA + 一个 Cloudflare Worker。没有 Electron / 本地 daemon / 原生安装包。 |
| **AI 运行时** | Vercel AI SDK 的 `ToolLoopAgent` **跑在浏览器 tab 里**。Tools（`edit_file` / `read_file` / `list_files` / `mark_done`）调 Worker 的 REST API 落盘文件；Worker 永远看不到 prompt 或 key。 |
| **Provider** | OpenRouter 是首选 fan-out（一把 key 通吃 Anthropic / OpenAI / Google / Mistral / xAI / DeepSeek / Groq / Cerebras …）。直连 SDK 也都接好：`@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}`，加任意 OpenAI 兼容端点。Key 全部存在 `localStorage`。 |
| **存储** | Cloudflare **D1**（SQLite）放元数据 + **R2** 放 sha256 内容寻址的文件 blob。一个 Worker 同时绑定。免费额度装得下绝大部分个人项目。 |
| **预览表面** | 沙盒 iframe，跑 React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 —— 由纯字符串拼接的 `srcdoc` 装载。React / npm 运行时依赖零泄漏。生产 / 离线 / 严格 CSP 场景可以 vendor UMD bundle。 |
| **Tweaks** | Artifact 内嵌 `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` 块声明可调设计 token。宿主 UI 把它渲染成滑杆 / 颜色拣选；改动通过 `EDIT_STYLE` postMessage 实时回流，不重跑模型。 |
| **Comment** | 在预览上随手点 pin 写评论，把 pin 上下文喂给 agent 做定向改写。 |
| **Edit** | 点任意 DOM 元素 —— 浮窗弹出，改 inline 样式或 Tailwind 类名，改动持久化回项目源文件。 |
| **Draw** | 用画笔工具在预览上画线；笔迹 + 截图作为下一回合输入，让模型按你手画的草图改。 |
| **Wire 协议** | HTTP REST + Server-Sent Events。单一来源在 [`packages/contracts`](packages/contracts/) —— 每条 SSE 事件类型、postMessage 类型、路由 shape 都是这里的字面量。 |
| **License** | Apache-2.0 |

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

> 你出 Cloudflare 账号；你的用户出自己的 LLM key。我们不跑托管 SaaS。

```bash
npm run cf:provision    # 一次性：wrangler login + 建 D1 / R2 + 应用 schema
npm run deploy          # 每次：部署 Worker（API） + Pages（SPA）
```

`npm run deploy` 跑完你会得到 `https://open-design-web.pages.dev`（SPA）+ `https://open-design-api.<your-subdomain>.workers.dev`（API）。

`cf:provision` 一次跑完：自动登录 Cloudflare（已登录就跳过）、创建 `open-design` D1 数据库并把 `database_id` 写回 [`apps/api/wrangler.toml`](apps/api/wrangler.toml)、创建 `open-design-blobs` R2 bucket、把 D1 schema 应用到远端。

`deploy` 一次跑完：部署 Worker、把 React + Babel UMD bundle vendor 到 `apps/web/public/vendor/`（让预览能离线 / 在内网 / 严格 CSP 下跑）、build SPA、推送到 Cloudflare Pages（项目 `open-design-web`）。

或者直接用内置的 GitHub Action —— push 到 `main` 触发 `.github/workflows/deploy.yml`，前提是你在仓库 secrets 里加了 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`（缺这两个时 workflow 会 no-op，所以 fork 仓库不会爆）。

### 自定义域名

在 Cloudflare 控制台给 Pages 项目挂自定义域（比如 `design.example.com`），给 Worker 挂另一个（比如 `api.design.example.com`）。SPA 期望 `/api/*` 能打到 worker —— 用 Pages Function route 或 Cloudflare Routes UI 把这个 path 重写过去。

把 SPA 的 origin 加到 Worker 的 [`apps/api/wrangler.toml`](apps/api/wrangler.toml) `[vars] ALLOWED_ORIGINS` 里（逗号分隔）再重 deploy Worker，否则 CORS 会拒掉请求。

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

欢迎 PR。项目 pre-alpha 阶段，贡献门槛宽松 —— 改个 typo、报个 bug、画一个 feature 草图都行。

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
