# Open Claude Design

> **把 [Claude Design](https://claude.ai/design) 複刻成一個開源的純 Web 應用。** Agent 驅動的原型設計工作台，配 **Tweaks · Comment · Edit · Draw** 四個就地預覽工具。Agent 跑在你的瀏覽器 tab 裡;一個 Cloudflare Worker（D1 + R2）負責存檔案。沒有 Electron、沒有本地 daemon、沒有伺服器端 LLM 代理。

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Status" src="https://img.shields.io/badge/狀態-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/技術棧-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#本地開發"><img alt="本地開發" src="https://img.shields.io/badge/本地開發-複製貼上一段-green?style=flat-square" /></a>
  <a href="#cloudflare-自部署"><img alt="自部署" src="https://img.shields.io/badge/自部署-複製貼上一段-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <b>繁體中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">作者：<a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **狀態:pre-alpha。** 架構已經穩定，四個預覽工具端到端跑通，但 wire 協議在任意 release 都可能出現 breaking change。如果你依賴協議字面量，請鎖版本。

## 為什麼有這個專案

Anthropic 的 [Claude Design](https://claude.ai/design) 把 LLM 變成了一個交付可互動設計成品的工具:chat 進、多檔案 React 原型出、隨手改任意元素、ship。它瞬間出圈，然後保持**閉源**、付費、只跑在雲上、綁死 Anthropic 的技術棧。

**Open Claude Design 是這套表面的一份開源忠實複刻，技術骨架對齊官方實作。** 在每個有取捨的地方，我們都優先參考 Anthropic 實際發出來的東西 —— artifact 格式、`EDITMODE` Tweaks 區塊、`<uuid>::verifier` 子 agent 命名約定、iframe 內的 Babel Standalone 渲染、四個工具的 `postMessage` 語法（`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …）。這份程式碼最大的單一輸入源，就是去讀懂 Anthropic 已經上線的執行環境。

我們和 Claude Design 在一個方向上分流:**純 Web，無外殼，不做 SaaS。** 整個產品跑在瀏覽器 tab + 一個 Cloudflare Worker。Chat agent（[Vercel AI SDK](https://github.com/vercel/ai) 的 tool-loop）**在你的瀏覽器 tab 裡**執行，直接拿你的 key 呼叫 OpenRouter —— Worker 只做儲存，永遠看不到你的 prompt。這個取捨換來三件事:

1. **免費 Cloudflare 帳號一段命令自部署** —— 沒有 Postgres、Redis、ECS、Docker。
2. **沒有帳號、沒有共享 SaaS、沒有配額** —— fork、deploy、把連結發給朋友。
3. **一份能讀完的程式碼** —— 嚴格 TS、npm workspaces、約 10 個原始碼資料夾。最有意思的部分（iframe runtime、`EDITMODE` 協議、瀏覽器側 agent 迴圈）一個週末讀得完。

## 致謝

這個專案站在很多人的工作之上。

**[Anthropic 的 Claude Design](https://claude.ai/design)** 是 Open Claude Design 想複刻的產品。原作團隊做出來的東西、立下的那條線，令我們由衷敬重 —— 每一層體驗裡都能看出他們花了多少心思。這份程式碼就是不斷向那條線靠攏的過程。

我們也想感謝同方向的另外兩個開源專案:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) —— 感謝他們在這個方向上投入了扎實、考量周全的開源工程。
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) —— 感謝他們把對同一問題的開源實作坦誠地公開發了出來。

它們讓「開源複刻」這件事的討論變得更豐富，我們由衷感謝這兩個專案存在。

### 工具鏈

- [Vercel AI SDK](https://github.com/vercel/ai) —— 多 provider 抽象，讓 agent 迴圈能在瀏覽器 tab 裡跑。
- [OpenRouter](https://openrouter.ai/) —— 一把 BYOK key，通吃幾十家 LLM provider。
- [React](https://react.dev/) 與 [Babel](https://babeljs.io/) —— UMD build 撐起瀏覽器內的預覽執行環境。
- [Cloudflare Workers](https://workers.cloudflare.com/)、[D1](https://developers.cloudflare.com/d1/) 與 [R2](https://developers.cloudflare.com/r2/) —— 無伺服器後端。
- [Hono](https://hono.dev/)、[Vite](https://vitejs.dev/)、[Turbo](https://turbo.build/)，以及更廣的 TypeScript / npm-workspaces 工具鏈。

## 免責聲明

Open Claude Design 是社群主導的開源複刻專案。**本專案與 Anthropic 沒有任何隸屬、認可或贊助關係。** "Claude" 與 "Claude Design" 是 Anthropic, PBC 的商標。

Agent 的部分行為指引 —— 具體指 [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) 下的 system prompt 內容 —— 改編自對 Anthropic 已上線 Claude Design 執行時的觀察。我們以「fair use / 互通性」為由保留這部分內容，以讓開源複刻盡量忠實於原作表面。

**若 Anthropic 團隊希望我們移除或重寫任何內容，我們會立即配合** —— 歡迎在 [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) 提 issue，或直接聯絡倉庫維護者。

## 一眼概覽

| | 你拿到的 |
|---|---|
| **形態** | 純 Web —— Vite SPA + 一個 Cloudflare Worker。沒有 Electron / 本地 daemon / 原生安裝包。 |
| **AI 執行環境** | Vercel AI SDK 的 `ToolLoopAgent` **跑在瀏覽器 tab 裡**。Tools（`edit_file` / `read_file` / `list_files` / `mark_done`）呼叫 Worker 的 REST API 落盤檔案;Worker 永遠看不到 prompt 或 key。 |
| **Provider** | OpenRouter 是首選 fan-out（一把 key 通吃 Anthropic / OpenAI / Google / Mistral / xAI / DeepSeek / Groq / Cerebras …）。直連 SDK 也都接好:`@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}`，加任意 OpenAI 相容端點。Key 全部存在 `localStorage`。 |
| **儲存** | Cloudflare **D1**（SQLite）放詮釋資料 + **R2** 放 sha256 內容定址的檔案 blob。一個 Worker 同時綁定。免費額度裝得下絕大部分個人專案。 |
| **預覽介面** | 沙盒 iframe，跑 React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 —— 由純字串拼接的 `srcdoc` 載入。React / npm 執行時依賴零洩漏。生產 / 離線 / 嚴格 CSP 場景可以 vendor UMD bundle。 |
| **Tweaks** | Artifact 內嵌 `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` 區塊宣告可調設計 token。宿主 UI 把它渲染成滑桿 / 顏色挑選器;改動透過 `EDIT_STYLE` postMessage 即時回流，不重跑模型。 |
| **Comment** | 在預覽上隨手點 pin 寫評論，把 pin 上下文餵給 agent 做定向改寫。 |
| **Edit** | 點任意 DOM 元素 —— 浮窗彈出，改 inline 樣式或 Tailwind 類別名稱，改動持久化回專案原始檔案。 |
| **Draw** | 用畫筆工具在預覽上畫線;筆跡 + 截圖作為下一回合輸入，讓模型按你手畫的草圖改。 |
| **Wire 協議** | HTTP REST + Server-Sent Events。單一來源在 [`packages/contracts`](packages/contracts/) —— 每條 SSE 事件型別、postMessage 型別、路由 shape 都是這裡的字面量。 |
| **License** | Apache-2.0 |

## 能做什麼

- **Chat → 生成**:自然語言描述 → AI 串流生成多檔案 React 原型，token 一邊產出一邊落到工作區。
- **Tweaks**:artifact 自宣告的設計 token 變成即時滑桿 / 顏色挑選器 —— 就地調，不重新 prompt。
- **Comment**:在預覽的某個座標點 pin 寫評論，pin 上下文跟著回到 agent 做定向改寫。
- **Edit**:點元素，浮動 inspector 裡改 inline 樣式或 Tailwind 類別，改動落回原始檔案。
- **Draw**:在預覽上手繪草圖，筆跡 + 截圖作為下一回合輸入，模型據此改圖。
- **多檔案專案**（`.jsx` / `.html` / `.css`）透過 Babel Standalone 在沙盒 iframe 渲染 —— entry 檔案按 `.html` > `.jsx`/`.tsx` 優先級解析。
- **可匯入** —— 把 Claude Design 匯出的 ZIP 拖進工作區，agent 接著 Anthropic 停下的地方繼續編輯。

## 技術棧

- **前端** —— Vite + React 18.3.1 + React Router v6 + styled-components
- **後端** —— [Hono](https://hono.dev/) on Cloudflare Workers
- **儲存** —— Cloudflare D1（詮釋資料）+ R2（sha256 內容定址 blob）
- **AI** —— [Vercel AI SDK](https://github.com/vercel/ai) `ToolLoopAgent` 跑在瀏覽器裡，直接拿使用者的 key 呼叫 OpenRouter / 10 家一線 provider
- **Wire** —— HTTP REST + SSE，schema 鎖在 [`packages/contracts`](packages/contracts/)
- **測試** —— Vitest（unit + integration）+ Playwright（e2e）

## 本地開發

**前置**:Node 22+，npm 10+。**不需要 Cloudflare 帳號** —— `wrangler` 的 `--local` 模式跑的是 `.wrangler/state/` 下的本地 SQLite。

把下面整段複製到一個新終端:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # 首次約 1 分鐘:裝相依套件 + 應用 D1 migration
npm run dev      # web :5173，api :8787（Ctrl-C 停）
```

dev server 起來後打開 <http://localhost:5173>。第一次發 chat 會讓你貼 OpenRouter API key —— 在 [openrouter.ai/keys](https://openrouter.ai/keys) 申請。Key 只存瀏覽器 `localStorage`;要清除或替換，造訪 `/settings`。

後續啟動只用跑 `npm run dev` 一條 —— `setup` 是一次性的。

> Sanity check:`curl http://localhost:8787/health` → `200 {"ok":true,...}`。

## Cloudflare 自部署

> 你出 Cloudflare 帳號;你的使用者出自己的 LLM key。我們不跑託管 SaaS。

```bash
npm run cf:provision    # 一次性:wrangler login + 建 D1 / R2 + 應用 schema
npm run deploy          # 每次:部署 Worker（API） + Pages（SPA）
```

`npm run deploy` 跑完你會得到 `https://open-design-web.pages.dev`（SPA）+ `https://open-design-api.<your-subdomain>.workers.dev`（API）。

`cf:provision` 一次跑完:自動登入 Cloudflare（已登入就跳過）、建立 `open-design` D1 資料庫並把 `database_id` 寫回 [`apps/api/wrangler.toml`](apps/api/wrangler.toml)、建立 `open-design-blobs` R2 bucket、把 D1 schema 應用到遠端。

`deploy` 一次跑完:部署 Worker、把 React + Babel UMD bundle vendor 到 `apps/web/public/vendor/`（讓預覽能離線 / 在內網 / 嚴格 CSP 下跑）、build SPA、推送到 Cloudflare Pages（專案 `open-design-web`）。

或者直接用內建的 GitHub Action —— push 到 `main` 觸發 `.github/workflows/deploy.yml`，前提是你在倉庫 secrets 裡加了 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`（缺這兩個時 workflow 會 no-op，所以 fork 倉庫不會爆）。

### 自訂網域

在 Cloudflare 控制台給 Pages 專案掛自訂網域（比如 `design.example.com`），給 Worker 掛另一個（比如 `api.design.example.com`）。SPA 期望 `/api/*` 能打到 worker —— 用 Pages Function route 或 Cloudflare Routes UI 把這個 path 重寫過去。

把 SPA 的 origin 加到 Worker 的 [`apps/api/wrangler.toml`](apps/api/wrangler.toml) `[vars] ALLOWED_ORIGINS` 裡（逗號分隔）再重 deploy Worker，否則 CORS 會拒掉請求。

## 倉庫結構

```
open-claude-design/
├── apps/
│   ├── web/                — 前端（Vite + React + styled-components）
│   │   └── src/features/
│   │       ├── chat/       — 瀏覽器側 ToolLoopAgent + tools + system prompts
│   │       ├── preview/    — Iframe + Tweaks/Comment/Edit/Draw 浮層
│   │       ├── workspace/  — 多 tab 檔案工作區 + 專案狀態
│   │       ├── home/       — 首頁、專案選擇器、範例藝廊
│   │       └── settings/   — BYOK key 管理
│   └── api/                — 後端（Hono on Cloudflare Workers + D1 + R2）
├── packages/
│   ├── contracts/          — 前後端共享 TypeScript wire 契約（單一來源）
│   ├── design-tokens/      — color / typography token（TS + CSS 雙源）
│   └── iframe-runtime/     — 注入 iframe 的 overlay + Tweaks bridge（零執行時依賴，純字串拼接）
└── e2e/                    — Playwright 端到端套件
```

## 貢獻

歡迎 PR。專案 pre-alpha 階段，貢獻門檻寬鬆 —— 改個 typo、回報 bug、畫一個 feature 草圖都行。

```bash
npm install
npm run typecheck   # 整個 workspace 跑 tsc --noEmit
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright（需要先 `npm run dev` 跑著）
```

分支策略、commit 約定、新人程式碼閱讀路徑見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[Apache License 2.0](LICENSE) —— fork、改、ship。
