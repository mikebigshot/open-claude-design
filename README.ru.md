# Open Claude Design

> **Open-source воссоздание [Claude Design](https://claude.ai/design) в виде чистого web-приложения.** Многофайловое прототипирование на React через chat с четырьмя инструментами предпросмотра прямо на месте — **Tweaks · Comment · Edit · Draw**. Agent работает в вашей вкладке браузера; единственный Cloudflare Worker (D1 + R2) хранит файлы. Никакого Electron, никакого локального daemon, никакого серверного LLM-прокси.

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Status" src="https://img.shields.io/badge/статус-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/стек-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#локальная-разработка"><img alt="Локальная разработка" src="https://img.shields.io/badge/локальная%20разработка-вставьте%20блок-green?style=flat-square" /></a>
  <a href="#self-host-на-cloudflare"><img alt="Self-host" src="https://img.shields.io/badge/self--host-вставьте%20блок-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr.md">Français</a> · <b>Русский</b> · <a href="README.ar.md">العربية</a></p>

<p align="center">Автор: <a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **Статус: pre-alpha.** Архитектура устаканилась, и все четыре инструмента предпросмотра работают end-to-end, но breaking changes всё ещё могут прилететь в любом release. Если вы завязаны на wire-формат — закрепляйте commit.

## Зачем это существует

[Claude Design](https://claude.ai/design) от Anthropic превратил LLM в инструмент, который выдаёт интерактивные дизайн-артефакты: chat на входе, многофайловый React-прототип на выходе, можно править любой элемент прямо на месте, ship. Это разлетелось вирально и осталось закрытым, платным, только в облаке, прибитым к стеку Anthropic.

**Open Claude Design — это верное open-source воссоздание этой поверхности с теми же техническими костями.** Везде, где у нас был выбор, мы опирались на то, что Anthropic реально выкатил — формат artifact, блок Tweaks `EDITMODE`, конвенция sub-agent `<uuid>::verifier`, путь in-iframe Babel Standalone для предпросмотра, грамматика `postMessage` четырёх инструментов (`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …). Самый крупный единственный вход для этого кода — чтение того, что опубликовал Anthropic.

**Как и в Claude Design, agent-loop остаётся во вкладке браузера, а chat / файлы / состояние проекта синхронизируются в ваш собственный backend.** Это самая важная точка структурного совпадения с оригиналом — облако Anthropic выступает только LLM-passthrough + исполнением tools + хранилищем снапшотов проекта, а сам agent-loop крутится в браузерной SPA. Мы делаем то же: tool-loop из [Vercel AI SDK](https://github.com/vercel/ai) работает в вашей вкладке, а chat / файлы / состояние проекта текут через Cloudflare Worker в D1 + R2, и Worker никогда не видит ваших prompt-ов. Эта форма **web-agent + backend-storage** — ровно та форма, которая масштабируется в SaaS.

## Архитектура

> Этот раздел — это неявная спецификация для кодовой базы. Выводы получены из логин-расследования `claude.ai/design` за 2026-04 — DOM-инспекция, перехват сети, чтение глобальных переменных, скачанные artifact-ы, деобфусцированный runtime и рабочий POC. Стараемся придерживаться непосредственно наблюдаемых фактов.

### Как устроен Claude Design

Та же форма, что и у Claude Code: браузер хостит agent, облако — это просто LLM-gateway + tool backend. Тело Chat-запроса одного хода — это прямой passthrough в Anthropic Messages API (полный system + tools + все messages, собирается на стороне клиента). Облачный `OmeletteService` **не поддерживает состояние диалога** — он только проксирует к LLM, исполняет tools и хранит снапшоты проектов.

```text
Browser SPA (Vite + React Router v6 + styled-components)
├── Main agent loop                          ← the actual agent host
│     while (not done):
│       POST OmeletteService.Chat (Anthropic Messages API passthrough)
│       parse tool_use → 9 routing buckets
├── Verifier sub-agent (UUID::verifier)      ← FORK BOUNDARY role injection
├── Preview iframe (*.claudeusercontent.com) ← srcdoc + injected runtime + postMessage RPC
└── Local-folder bridge (File System Access API) ← 4 local_* tools via native browser API
                ↓ Connect / gRPC-Web + Protobuf
OmeletteService (thin LLM proxy + tool backend)
   Chat              → api.anthropic.com passthrough
   EditFile / GetFile / ListFiles / RecordAsset → project sandbox CRUD
   UpdateProjectData → client-authoritative full snapshot
   McpListTools      → third-party MCP server tool discovery
   MintPreviewToken  → short-lived preview signature
```

#### Ключевые наблюдения

| Параметр | Что реально едет в production |
|---|---|
| Frontend основного приложения | Vite + React Router v6 + styled-components; редактор кода — это нативный `<textarea>` плюс самописные `<div>` для номеров строк — никакой Monaco, никакого CodeMirror |
| Backend-протокол | Connect / gRPC-Web + Protobuf; имя сервиса `anthropic.omelette.api.v1alpha.OmeletteService` |
| Протокол tool-ов agent-а | MCP (Model Context Protocol) — поймали полный payload `tools/list` с полем `defer_loading`; сторонние MCP-серверы реально подключаются |
| Маршрутизация tool-ов | 30+ tools раскидываются по 9 ведёркам: облачный RPC (EditFile / GetFile / …) / локальный FSA (local_*) / iframe DOM (show_html / eval_js / screenshot) / чистая клиентская логика (snip / update_todos) / spawned sub-agent / сторонний MCP / встроенные в LLM (web_search / web_fetch) |
| Verifier sub-agent | Делит с основным agent **system prompt + toolset + history**; весь fork — это просто role-reset prompt, засунутый в fork tool_result + суффикс `::verifier` к sessionUUID + max_tokens поделённый пополам |
| Preview iframe | Каждый проект на своём поддомене `{project-uuid}.claudeusercontent.com`; основной сайт ставит CSP `default-src 'none'; frame-ancestors 'none'`; preview-токены — это 4 сегмента: `{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}` |
| Runtime для сгенерированного artifact | React **18.3.1** + Babel Standalone **7.29.0** (UMD, привязан integrity-hash) + inline `style={{...}}` JS-объекты + Google Fonts + multi-JSX `<script type="text/babel" src="*.jsx">`, монтируется на глобальный window |
| Tweaks-протокол | Artifact-ы вставляют блоки `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` + `EDIT_STYLE` postMessage пишет обратно вживую, без перезапуска модели |
| Client-authoritative storage | Браузер держит полные chats / messages / contentBlocks / I/O tool-ов / viewState / манифест assets и пушит полный снапшот обратно через `UpdateProjectData`. **Каждый вызов tool с input/output персистится** |
| Compound-операция `done` | Триггерит цепочку EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData |
| Streaming | Не нативный Anthropic SSE — OmeletteService переоборачивает его в кастомные кадры: `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` |
| Local-folder bridge | File System Access API + 4 tool-а `local_*` (local_ls / local_read / local_grep / local_copy_to_project); локальные файлы **никогда** не попадают в OmeletteService — они появляются только в LLM-контексте |

### Как устроен Open Claude Design

Эту диаграмму мы переносим как есть: agent-loop в браузере, облако — только хранилище. Общая форма совпадает с оригиналом; упрощаем только инженерные компромиссы (HTTP REST вместо Connect / gRPC-Web, Cloudflare Worker вместо кастомного backend, BYOK вместо хостед-ключей).

```text
Browser SPA (Vite + React 18.3.1 + React Router v6 + styled-components)
├── Main agent loop                          ← ToolLoopAgent (Vercel AI SDK)
│     while (not done):
│       streamText({ system, tools, messages, model })  ← assembled client-side, direct to LLM
│       parse tool_use → execute in browser
├── tools (apps/web/src/features/chat/tools/)
│     edit_file / read_file / list_files / mark_done
│     ↓ tool execute fetches the worker REST endpoints
├── Preview iframe (loaded via srcdoc)       ← React 18.3.1 + Babel Standalone 7.29.0
│     postMessage RPC: SET_MODE / EDIT_STYLE /
│     ELEMENT_SELECTED / OVERLAY_READY / IFRAME_ERROR
└── Tweaks / Comment / Edit / Draw — four overlay tools
                ↓ HTTP REST + SSE (schemas locked in packages/contracts)
Cloudflare Worker (apps/api, Hono — outside the chat path, storage-only)
   /api/projects/:id/files/:path  → D1 + R2 CRUD
   /api/projects/:id/share-link   → short-lived signed link
   /api/share/:token              → public preview
   ├── D1 (SQLite): project metadata + path → content_hash mapping
   └── R2: sha256 content-addressed blobs

LLM provider (user BYOK, browser-direct, invisible to the worker)
   openrouter.ai or any OpenAI-compatible endpoint
```

#### Что мы сохраняем от оригинала

- **Agent-loop на стороне браузера** — `ToolLoopAgent` из Vercel AI SDK работает во вкладке (agent-фреймворк оригинала не публичен, но host тот же)
- **Client-authoritative + backend-снапшот** — D1 хранит метаданные проекта, R2 хранит sha256 content-addressed blob-ы, пишутся как полные снапшоты
- **Runtime preview iframe** — React 18.3.1 + Babel Standalone 7.29.0, те же версии и integrity-хеши, семантика multi-JSX entry сохранена
- **Литералы протокола** — `EDITMODE-BEGIN/END` для Tweaks, типы postMessage `SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY`, конвенция именования sub-agent `<uuid>::verifier` — всё сохранено дословно

#### Где мы намеренно расходимся

- **Wire-протокол** — упрощён с Connect / gRPC-Web до HTTP REST + SSE (схемы в [`packages/contracts`](packages/contracts/), без переиспользования `.proto`)
- **Шрифты** — коммерческий Anthropic Serif заменён на Google Fonts (Inter / Instrument Serif / JetBrains Mono); иконки через Lucide
- **Поддомен предпросмотра** — `*.claudeusercontent.com` заменён на дефолтный поддомен Cloudflare Pages (свой домен — на self-host)
- **Local-folder bridge / сторонний MCP / verifier sub-agent** — пока не реализованы (roadmap)

## Отличия от nexu-io/open-design и OpenCoworkAI/open-codesign

Все три проекта — open-source воссоздания Claude Design. Расхождение в основном про то, **где живёт agent-loop и куда уходят chat / файлы**.

|  | Claude Design (оригинал) | [open-codesign][ocod] | [nexu-io/open-design][nexu] | **Open Claude Design** |
|---|---|---|---|---|
| Форм-фактор | Web (claude.ai) | Desktop (Electron) | Web-приложение + локальный daemon | **Чистый web + Cloudflare Workers** |
| Где работает agent-loop | Вкладка браузера | Внутри main-процесса Electron, бандлит [pi-ai] | CLI, который у вас уже стоит на диске (Claude Code / Codex / Cursor / Gemini / … 13 адаптеров) | **Вкладка браузера (Vercel AI SDK ToolLoopAgent, BYOK)** |
| Где живут chat / файлы | Облако (OmeletteService + content-addressed blob-ы) | Локальный SQLite + локальная файловая система | Локальный SQLite + локальная файловая система | **Cloudflare D1 + R2 (ваш аккаунт)** |
| Нужен локальный CLI / desktop-shell? | Нет | Да (Electron-инсталлятор) | Да (npm + один из 13 CLI) | **Нет — открыли страницу в браузере** |
| Структурная верность оригиналу | 100% | Средняя (agent на desktop-runtime, не в web) | Средняя (agent в CLI пользователя, спаунится daemon-ом) | **Высокая — agent в браузере + backend как хранилище, та же форма, что и у оригинала** |
| Лицензия | Closed | MIT | Apache-2.0 | Apache-2.0 |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

Короче: **open-codesign и nexu-io — local-first (agent на desktop или в CLI пользователя, файлы на диске); мы и оригинальный Claude Design — web-first (agent в браузере, файлы в облачном backend)**. У каждого есть свои компромиссы — мы выбрали тот, что структурно наиболее близок к тому, что Anthropic реально выкатил.

## Благодарности

Этот проект построен на работе многих других людей.

**[Claude Design от Anthropic](https://claude.ai/design)** — это продукт, который Open Claude Design воссоздаёт. Мы испытываем огромное уважение к тому, что построила оригинальная команда, и к планке, которую они задали — каждый слой опыта отражает, насколько им было не всё равно. Этот код — процесс дотягивания до этой планки.

Также хотим поблагодарить два других open-source проекта в этом пространстве:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — за основательную, тщательно продуманную open-source инженерию, которую они вложили в это направление.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — за то, что открыто опубликовали свой взгляд на ту же задачу.

Оба сделали open-source разговор вокруг этого продукта богаче, и мы благодарны, что они существуют.

### Инструментарий

- [Vercel AI SDK](https://github.com/vercel/ai) — multi-provider абстракция, благодаря которой agent-loop работает во вкладке браузера.
- [React](https://react.dev/) и [Babel](https://babeljs.io/) — UMD-сборки, питающие in-iframe runtime предпросмотра.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/) и [R2](https://developers.cloudflare.com/r2/) — backend без сервера, за которым нужно следить.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/) и более широкий toolchain TypeScript / npm-workspaces.

## Отказ от ответственности

Open Claude Design — это сообществом созданный open-source-проект, воссоздающий Claude Design. **Проект не аффилирован с Anthropic, не поддерживается и не спонсируется им.** «Claude» и «Claude Design» — товарные знаки Anthropic, PBC.

Часть инструкций поведения agent — конкретно содержимое system prompt в [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — адаптирована из наблюдений за публичным runtime Claude Design от Anthropic. Мы сохраняем этот контент по обоснованию fair use / совместимости, чтобы open-source-воссоздание оставалось максимально близким к оригинальной поверхности.

**Если кто-то из Anthropic захочет, чтобы мы убрали или переписали какой-либо контент, мы сделаем это незамедлительно** — пожалуйста, откройте issue на [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) или свяжитесь с мейнтейнером репозитория.

## Что оно делает

- **Chat → генерация** многофайлового React-прототипа, потоком token за token-ом в workspace проекта.
- **Tweaks**: design token-ы, объявленные в artifact, становятся живыми ползунками / color picker-ами — крутите на месте, без re-prompt.
- **Comment**: пинуйте аннотации к координатам на предпросмотре; отправляйте контекст pin-а обратно agent-у для точечных переписей.
- **Edit**: кликаете любой элемент, правите inline-стили или Tailwind-классы во всплывающем inspector, изменения сохраняются обратно в исходники.
- **Draw**: рисуете поверх предпросмотра от руки; штрихи и скриншот уезжают в следующий ход, чтобы модель действовала по вашей подсказке.
- **Многофайловые проекты** (`.jsx` / `.html` / `.css`) рендерятся через Babel Standalone в песочном iframe — entry resolution предпочитает `.html`, затем `.jsx`/`.tsx`.
- **Импортируемо** — киньте ZIP-экспорт из Claude Design на workspace и продолжайте редактировать с того места, где Anthropic остановился.

## Стек

- **Frontend** — Vite + React 18.3.1 + React Router v6 + styled-components
- **Backend** — [Hono](https://hono.dev/) на Cloudflare Workers
- **Хранилище** — Cloudflare D1 (метаданные) + R2 (sha256-адресуемые blob-ы)
- **AI** — `ToolLoopAgent` из [Vercel AI SDK](https://github.com/vercel/ai), работающий в браузере, вызывает OpenRouter или любой из 10 first-party провайдеров напрямую через key пользователя
- **Wire** — HTTP REST + SSE, схемы зафиксированы в [`packages/contracts`](packages/contracts/)
- **Тесты** — Vitest (unit + integration) и Playwright (e2e)

## Локальная разработка

**Требования**: Node 22+, npm 10+. Аккаунт Cloudflare не нужен — `wrangler` крутит D1 в режиме `--local` против файла SQLite в `.wrangler/state/`.

Скопируйте этот блок целиком в свежий terminal:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # ~1 минута на первом запуске: ставит зависимости + применяет D1 migration
npm run dev      # web на :5173, api на :8787 (Ctrl-C для остановки)
```

Когда dev server поднимется, откройте <http://localhost:5173>. Первое сообщение в chat попросит OpenRouter API key — возьмите его на [openrouter.ai/keys](https://openrouter.ai/keys) и вставьте. Key живёт только в `localStorage` вашего браузера; очистите или замените его в любой момент в `/settings`.

В следующих сессиях нужен только `npm run dev` — `setup` одноразовый.

> Sanity check: `curl http://localhost:8787/health` → `200 {"ok":true,...}`.

## Self-host на Cloudflare

> Вы приносите аккаунт Cloudflare; ваши пользователи приносят свои LLM key.

```bash
npm run cf:provision    # один раз: wrangler login + создать D1 / R2 + применить schema
npm run deploy          # каждый раз: ship Worker (API) + Pages (SPA)
```

После того как `npm run deploy` отработает, у вас будут `https://open-design-web.pages.dev` (SPA) и `https://open-design-api.<your-subdomain>.workers.dev` (API).

Что делает `cf:provision` за один заход: логинит вас в Cloudflare (пропускает, если уже залогинены), создаёт D1-базу `open-design` и записывает её `database_id` обратно в [`apps/api/wrangler.toml`](apps/api/wrangler.toml), создаёт R2 bucket `open-design-blobs`, применяет D1 schema.

Что делает `deploy`: деплоит Worker, vendor-ит UMD-bundle React + Babel в `apps/web/public/vendor/`, чтобы предпросмотры работали offline / за firewall / при строгом CSP, билдит SPA, шипит на Cloudflare Pages (проект `open-design-web`).

Или используйте встроенный GitHub Action — push в `main` триггерит `.github/workflows/deploy.yml`, как только вы добавите `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` в repo secrets (без них workflow no-op-ит, поэтому fork репозитория безопасен).

## Структура repo

```
open-claude-design/
├── apps/
│   ├── web/                — Frontend (Vite + React + styled-components)
│   │   └── src/features/
│   │       ├── chat/       — Browser-side ToolLoopAgent + tools + system prompts
│   │       ├── preview/    — Iframe + Tweaks/Comment/Edit/Draw overlays
│   │       ├── workspace/  — Multi-tab file workspace + project state
│   │       ├── home/       — Landing, project picker, examples gallery
│   │       └── settings/   — BYOK key management
│   └── api/                — Backend (Hono на Cloudflare Workers + D1 + R2)
├── packages/
│   ├── contracts/          — Shared TypeScript wire contracts (единый источник истины)
│   ├── design-tokens/      — Color/typography token-ы (TS + CSS dual-source)
│   └── iframe-runtime/     — In-iframe overlay + Tweaks bridge (zero runtime deps, чистая сборка строк)
└── e2e/                    — Playwright end-to-end suite
```

## Контрибьютинг

PR-ы приветствуются. Проект в pre-alpha, и планка для контрибьюции низкая.

```bash
npm install
npm run typecheck   # tsc --noEmit по всему workspace
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright (требует запущенного `npm run dev`)
```

См. [CONTRIBUTING.md](CONTRIBUTING.md) для веток, конвенций commit-ов и направляющего пути чтения по коду.

## License

[Apache License 2.0](LICENSE) — fork, modify, ship.
