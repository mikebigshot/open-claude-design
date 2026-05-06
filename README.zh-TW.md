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

> ⚠️ **狀態:pre-alpha。** 架構已經穩定，四個預覽工具端到端跑通，但 wire 協定在任意 release 都可能出現 breaking change。如果你依賴協定字面量，請鎖版本。

## 為什麼有這個專案

Anthropic 的 [Claude Design](https://claude.ai/design) 把 LLM 變成了一個交付可互動設計成品的工具:chat 進、多檔案 React 原型出、隨手改任意元素、ship。它瞬間出圈，然後保持**閉源**、付費、只跑在雲上、綁死 Anthropic 的技術棧。

**Open Claude Design 是這套表面的一份開源忠實複刻，技術骨架對齊官方實作。** 在每個有取捨的地方，我們都優先參考 Anthropic 實際發出來的東西 —— artifact 格式、`EDITMODE` Tweaks 區塊、`<uuid>::verifier` 子 agent 命名約定、iframe 內的 Babel Standalone 渲染、四個工具的 `postMessage` 語法（`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …）。這份程式碼最大的單一輸入源，就是去讀懂 Anthropic 已經上線的執行環境。

**和 Claude Design 一樣，agent loop 留在瀏覽器 tab 裡，chat / 檔案 / 專案狀態同步到自己的後端。** 這是我們與原版最關鍵的同構點 —— Anthropic 在雲端只做 LLM 透傳 + 工具執行 + 專案快照儲存，agent 迴圈本體跑在瀏覽器 SPA 裡;我們用 [Vercel AI SDK](https://github.com/vercel/ai) 的 tool loop 同樣跑在瀏覽器 tab，chat / 檔案 / 專案狀態走 Cloudflare Worker 落到 D1 + R2，Worker 永遠看不到你的 prompt。這套 **web agent + 後端儲存**的形態，也是最適合演進成 SaaS 的。

## 技術架構

> 這一節是這套程式碼的隱性 spec。結論來自我們 2026-04 期間對 `claude.ai/design` 的真實登入態調研 —— DOM / 網路抓包 / 全域變數 / 真實下載產物 / 反混淆 runtime / 實測 POC，盡量只列直接觀察到的事實。

### 原版 Claude Design 長什麼樣

跟 Claude Code 同一類:瀏覽器是 agent 的宿主，雲端只是 LLM 閘道 + 工具後端。一個 turn 的 Chat 請求體直接是 Anthropic Messages API 透傳（含完整 system + tools + 全部 messages，由瀏覽器側組裝），雲端 `OmeletteService` **不維護對話狀態**，只做 LLM 透傳 + 工具執行 + 專案快照儲存。

```text
瀏覽器 SPA（Vite + React Router v6 + styled-components）
├── 主 agent loop                          ← agent 真正的宿主
│     while (not done):
│       POST OmeletteService.Chat (Anthropic Messages API 透傳)
│       parse tool_use → 9 類執行端
├── Verifier 子 agent（UUID::verifier）     ← FORK BOUNDARY 角色注入
├── 預覽 iframe（*.claudeusercontent.com） ← srcdoc + runtime 注入 + postMessage RPC
└── 本地檔案夾橋（File System Access API） ← 4 個 local_* 工具走瀏覽器原生 API
                ↓ Connect / gRPC-Web + Protobuf
OmeletteService（thin LLM proxy + 工具後端）
   Chat              → api.anthropic.com 透傳
   EditFile / GetFile / ListFiles / RecordAsset → 專案沙箱 CRUD
   UpdateProjectData → 客戶端權威狀態整快照
   McpListTools      → 第三方 MCP server 工具發現
   MintPreviewToken  → preview 短期簽名
```

#### 關鍵觀察

| 維度 | 實際實作 |
|---|---|
| 主 app 前端棧 | Vite + React Router v6 + styled-components;程式碼編輯器是原生 `<textarea>` + 手寫 `<div>` 行號，無 Monaco / CodeMirror |
| 後端協定 | Connect / gRPC-Web + Protobuf;Service 名 `anthropic.omelette.api.v1alpha.OmeletteService` |
| Agent 工具協定 | MCP（Model Context Protocol）—— 抓到完整 `tools/list` 資料 + `defer_loading` 欄位，第三方 MCP server 真實可接入 |
| 工具路由 | 30+ 工具按 9 類分發:雲端 RPC（EditFile / GetFile / …）/ 本地 FSA（local_*）/ iframe DOM（show_html / eval_js / screenshot）/ 客戶端純邏輯（snip / update_todos）/ 派生 sub-agent / 第三方 MCP / LLM 內建（web_search / web_fetch） |
| Verifier 子 agent | 跟主 agent **共享 system prompt + 共享工具集 + 共享 history**，僅靠在 fork tool_result 裡塞角色重置 prompt + sessionUUID 追加 `::verifier` 後綴 + max_tokens 砍半實作 |
| 預覽 iframe | 每個專案獨立子網域 `{project-uuid}.claudeusercontent.com`;主站 CSP `default-src 'none'; frame-ancestors 'none'`;token 4 段:`{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}` |
| 生成產物執行時 | React **18.3.1** + Babel Standalone **7.29.0**（UMD，integrity hash 鎖死）+ 內聯 `style={{...}}` JS 物件 + Google Fonts + 多 JSX `<script type="text/babel" src="*.jsx">` 全域 window 掛載 |
| Tweaks 協定 | artifact 內嵌 `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` + `EDIT_STYLE` postMessage 即時回寫，不重跑模型 |
| 客戶端權威儲存 | 瀏覽器持有完整 chats / messages / contentBlocks / 工具 IO / viewState / assets manifest，定期透過 `UpdateProjectData` 整包推回雲端;**每個 tool call 的 input/output 都被持久化** |
| `done` 複合操作 | EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData 一連串觸發 |
| Streaming | 不是 Anthropic 原生 SSE，OmeletteService 重新封裝為 `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` 自訂幀 |
| 本地檔案夾橋 | File System Access API + 4 個 `local_*` 工具（local_ls / local_read / local_grep / local_copy_to_project）;本地檔案**不傳** OmeletteService，只在 LLM 上下文裡出現 |

### Open Claude Design 長什麼樣

我們把上面那張圖原樣搬過來:agent loop 留在瀏覽器，雲端只做儲存。整體形態對齊，只在工程取捨上簡化（HTTP REST 替 Connect / gRPC-Web、Cloudflare Worker 替自研後端、BYOK 替託管 key）。

```text
瀏覽器 SPA（Vite + React 18.3.1 + React Router v6 + styled-components）
├── 主 agent loop                          ← ToolLoopAgent（Vercel AI SDK）
│     while (not done):
│       streamText({ system, tools, messages, model })  ← 瀏覽器側組裝 + 直連 LLM
│       parse tool_use → 瀏覽器側 execute
├── tools（apps/web/src/features/chat/tools/）
│     edit_file / read_file / list_files / mark_done
│     ↓ tool execute 內部 fetch worker REST
├── 預覽 iframe（srcdoc 裝載）              ← React 18.3.1 + Babel Standalone 7.29.0
│     postMessage RPC：SET_MODE / EDIT_STYLE /
│     ELEMENT_SELECTED / OVERLAY_READY / IFRAME_ERROR
└── Tweaks / Comment / Edit / Draw 四個浮層工具
                ↓ HTTP REST + SSE（schema 鎖在 packages/contracts）
Cloudflare Worker（apps/api，Hono — 不參與 chat path，僅檔案儲存）
   /api/projects/:id/files/:path  → D1 + R2 CRUD
   /api/projects/:id/share-link   → 短期簽名連結
   /api/share/:token              → 公共預覽
   ├── D1（SQLite）：專案詮釋資料 + 檔案路徑 → content_hash 對映
   └── R2：sha256 內容定址 blob

LLM provider（使用者 BYOK，瀏覽器直連，worker 看不見）
   openrouter.ai 或任意 OpenAI 相容端點
```

#### 沿用了哪些

- **瀏覽器側 agent loop** —— Vercel AI SDK 的 `ToolLoopAgent` 在 tab 裡跑（原版用什麼 agent 框架未公開，但 loop 宿主同位）
- **客戶端權威 + 後端整快照** —— D1 存專案詮釋資料 + R2 存 sha256 內容定址 blob，整包寫入
- **預覽 iframe 的執行時棧** —— React 18.3.1 + Babel Standalone 7.29.0 同版本同 integrity，多 JSX 入口同語意
- **協定字面量** —— Tweaks 的 `EDITMODE-BEGIN/END`、`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` 等 postMessage 類型、`<uuid>::verifier` 子 agent 命名約定，全部保留

#### 主動偏離的地方

- **Wire 協定** 從 Connect / gRPC-Web 簡化到 HTTP REST + SSE（schema 鎖在 [`packages/contracts`](packages/contracts/)，`.proto` 沒複用）
- **字型** 從商業 Anthropic Serif 換成 Google Fonts（Inter / Instrument Serif / JetBrains Mono），圖示用 Lucide
- **預覽子網域** 從 `*.claudeusercontent.com` 換成 Cloudflare Pages 預設子網域（自部署可綁網域）
- **本地檔案橋 / 第三方 MCP / verifier 子 agent** 暫未實裝（roadmap）

## 跟 nexu-io/open-design、OpenCoworkAI/open-codesign 的區別

三個專案都是 Claude Design 的開源複刻，差異主要在 **agent loop 跑在哪、chat / 檔案落在哪**。

|  | Claude Design（原版） | [open-codesign][ocod] | [nexu-io/open-design][nexu] | **Open Claude Design** |
|---|---|---|---|---|
| 形態 | Web (claude.ai) | Desktop (Electron) | Web app + 本地 daemon | **純 Web + Cloudflare Workers** |
| Agent loop 跑在哪 | 瀏覽器 tab | Electron 主行程內捆綁 [pi-ai] | 使用者已裝的 CLI（Claude Code / Codex / Cursor / Gemini / … 13 個適配器） | **瀏覽器 tab（Vercel AI SDK ToolLoopAgent，BYOK）** |
| Chat / 檔案落在哪 | 雲端（OmeletteService + 內容定址 blob） | 本地 SQLite + 本地檔案系統 | 本地 SQLite + 本地檔案系統 | **Cloudflare D1 + R2（你自己的帳號）** |
| 是否需要本地裝 CLI / 桌面殼 | 不需要 | 需要（Electron 安裝包） | 需要（npm + 13 個 CLI 之一） | **不需要 —— 瀏覽器開網頁就能用** |
| 跟原版的同構度 | 100% | 中（agent 在桌面 runtime 而非 web） | 中（agent 在使用者 CLI，靠 daemon spawn） | **高 —— 瀏覽器跑 agent + 後端只做儲存，跟原版同位** |
| License | 閉源 | MIT | Apache-2.0 | Apache-2.0 |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

簡言之：**open-codesign / nexu-io 是 local-first（agent 在桌面或使用者 CLI、檔案在本地）；我們和原版 Claude Design 一樣是 web-first（agent 在瀏覽器、檔案在雲端後端）**。三種形態各有取捨 —— 我們這一版選了跟 Anthropic 已上線產品最同構的那條路線。

## 致謝

這個專案站在很多人的工作之上。

**[Anthropic 的 Claude Design](https://claude.ai/design)** 是 Open Claude Design 想複刻的產品。原作團隊做出來的東西、立下的那條線，令我們由衷敬重 —— 每一層體驗裡都能看出他們花了多少心思。這份程式碼就是不斷向那條線靠攏的過程。

我們也想感謝同方向的另外兩個開源專案:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) —— 感謝他們在這個方向上投入了扎實、考量周全的開源工程。
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) —— 感謝他們把對同一問題的開源實作坦誠地公開發了出來。

它們讓「開源複刻」這件事的討論變得更豐富，我們由衷感謝這兩個專案存在。

### 工具鏈

- [Vercel AI SDK](https://github.com/vercel/ai) —— 多 provider 抽象，讓 agent 迴圈能在瀏覽器 tab 裡跑。
- [React](https://react.dev/) 與 [Babel](https://babeljs.io/) —— UMD build 撐起瀏覽器內的預覽執行環境。
- [Cloudflare Workers](https://workers.cloudflare.com/)、[D1](https://developers.cloudflare.com/d1/) 與 [R2](https://developers.cloudflare.com/r2/) —— 無伺服器後端。
- [Hono](https://hono.dev/)、[Vite](https://vitejs.dev/)、[Turbo](https://turbo.build/)，以及更廣的 TypeScript / npm-workspaces 工具鏈。

## 免責聲明

Open Claude Design 是社群主導的開源複刻專案。**本專案與 Anthropic 沒有任何隸屬、認可或贊助關係。** "Claude" 與 "Claude Design" 是 Anthropic, PBC 的商標。

Agent 的部分行為指引 —— 具體指 [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) 下的 system prompt 內容 —— 改編自對 Anthropic 已上線 Claude Design 執行時的觀察。我們以「fair use / 互通性」為由保留這部分內容，以讓開源複刻盡量忠實於原作表面。

**若 Anthropic 團隊希望我們移除或重寫任何內容，我們會立即配合** —— 歡迎在 [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) 提 issue，或直接聯絡倉庫維護者。

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

> 你出 Cloudflare 帳號;你的使用者出自己的 LLM key。

```bash
npm run cf:provision    # 一次性:wrangler login + 建 D1 / R2 + 應用 schema
npm run deploy          # 每次:部署 Worker（API） + Pages（SPA）
```

`npm run deploy` 跑完你會得到 `https://open-design-web.pages.dev`（SPA）+ `https://open-design-api.<your-subdomain>.workers.dev`（API）。

`cf:provision` 一次跑完:自動登入 Cloudflare（已登入就跳過）、建立 `open-design` D1 資料庫並把 `database_id` 寫回 [`apps/api/wrangler.toml`](apps/api/wrangler.toml)、建立 `open-design-blobs` R2 bucket、把 D1 schema 應用到遠端。

`deploy` 一次跑完:部署 Worker、把 React + Babel UMD bundle vendor 到 `apps/web/public/vendor/`（讓預覽能離線 / 在內網 / 嚴格 CSP 下跑）、build SPA、推送到 Cloudflare Pages（專案 `open-design-web`）。

或者直接用內建的 GitHub Action —— push 到 `main` 觸發 `.github/workflows/deploy.yml`，前提是你在倉庫 secrets 裡加了 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`（缺這兩個時 workflow 會 no-op，所以 fork 倉庫不會爆）。

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

歡迎 PR。專案 pre-alpha 階段，貢獻門檻寬鬆。

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
