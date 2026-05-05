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

Мы расходимся с Claude Design в одном направлении: **чистый web, никакой оболочки, никакого SaaS.** Всё работает во вкладке браузера плюс один Cloudflare Worker. Chat-agent (tool-loop из [Vercel AI SDK](https://github.com/vercel/ai)) исполняется _в вашей вкладке_ и общается с OpenRouter напрямую через ваш key — Worker занимается только хранением и никогда не видит ваших prompt-ов. Эта сделка покупает три вещи:

1. **Deploy одной командой на бесплатном аккаунте Cloudflare** — никакого Postgres, Redis, ECS, Docker.
2. **Ни аккаунтов, ни общего SaaS, ни квот** — fork, deploy, кидайте друзьям ссылку.
3. **Читаемая кодовая база** — строгий TS, npm workspaces, ~10 папок с исходниками. Самые интересные части (iframe runtime, протокол `EDITMODE`, agent-loop в браузере) укладываются в чтение на выходные.

## Благодарности

Этот проект построен на работе многих других людей.

**[Claude Design от Anthropic](https://claude.ai/design)** — это продукт, который Open Claude Design воссоздаёт. Мы испытываем огромное уважение к тому, что построила оригинальная команда, и к планке, которую они задали — каждый слой опыта отражает, насколько им было не всё равно. Этот код — процесс дотягивания до этой планки.

Также хотим поблагодарить два других open-source проекта в этом пространстве:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — за основательную, тщательно продуманную open-source инженерию, которую они вложили в это направление.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — за то, что открыто опубликовали свой взгляд на ту же задачу.

Оба сделали open-source разговор вокруг этого продукта богаче, и мы благодарны, что они существуют.

### Инструментарий

- [Vercel AI SDK](https://github.com/vercel/ai) — multi-provider абстракция, благодаря которой agent-loop работает во вкладке браузера.
- [OpenRouter](https://openrouter.ai/) — один BYOK key перед десятками LLM-провайдеров.
- [React](https://react.dev/) и [Babel](https://babeljs.io/) — UMD-сборки, питающие in-iframe runtime предпросмотра.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/) и [R2](https://developers.cloudflare.com/r2/) — backend без сервера, за которым нужно следить.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/) и более широкий toolchain TypeScript / npm-workspaces.

## Отказ от ответственности

Open Claude Design — это сообществом созданный open-source-проект, воссоздающий Claude Design. **Проект не аффилирован с Anthropic, не поддерживается и не спонсируется им.** «Claude» и «Claude Design» — товарные знаки Anthropic, PBC.

Часть инструкций поведения agent — конкретно содержимое system prompt в [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — адаптирована из наблюдений за публичным runtime Claude Design от Anthropic. Мы сохраняем этот контент по обоснованию fair use / совместимости, чтобы open-source-воссоздание оставалось максимально близким к оригинальной поверхности.

**Если кто-то из Anthropic захочет, чтобы мы убрали или переписали какой-либо контент, мы сделаем это незамедлительно** — пожалуйста, откройте issue на [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) или свяжитесь с мейнтейнером репозитория.

## Одним взглядом

| | Что вы получаете |
|---|---|
| **Форм-фактор** | Чистый web — Vite SPA + один Cloudflare Worker. Никакого Electron, никакого локального daemon, никаких нативных установщиков. |
| **AI runtime** | `ToolLoopAgent` из Vercel AI SDK работает **во вкладке браузера**. Tools (`edit_file` / `read_file` / `list_files` / `mark_done`) вызывают REST API Worker-а для сохранения файлов; Worker никогда не видит prompt-ов или ключей. |
| **Провайдеры** | OpenRouter — это default fan-out (один key → Anthropic, OpenAI, Google, Mistral, xAI, DeepSeek, Groq, Cerebras, …). Прямые SDK провайдеров тоже подключены: `@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}` плюс любой OpenAI-совместимый endpoint. Ключи живут в `localStorage`. |
| **Хранилище** | Cloudflare **D1** (SQLite) для метаданных + **R2** для sha256 content-addressed blob-ов файлов. Один Worker связывает оба. Бесплатного тарифа хватает с запасом для сольных проектов. |
| **Поверхность предпросмотра** | Песочный iframe, рендерящий React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 — собирается из чистого строкового `srcdoc`. Ноль протечек React/npm runtime в предпросмотр. UMD-bundle можно vendor-нуть для offline / строгий CSP deploy. |
| **Tweaks** | Artifact-ы выдают блок `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/`, объявляющий настраиваемые design token-ы. Host UI выводит ползунки / pickers; изменения текут обратно как `EDIT_STYLE` `postMessage`-события без перезапуска модели. |
| **Comment** | Кидайте pin-ы куда угодно по живому предпросмотру, пишите комментарий, отправляйте контекст pin-а agent-у для точечной переписи. |
| **Edit** | Кликаете по любому DOM-элементу — всплывает inspector, вы крутите inline-стили или Tailwind-классы, изменение сохраняется обратно в файлы проекта. |
| **Draw** | Скетчите поверх предпросмотра pen-инструментом; штрихи плюс скриншот летят в модель, чтобы она переписала по вашему ручному наброску. |
| **Wire** | HTTP REST + Server-Sent Events. Единый источник истины в [`packages/contracts`](packages/contracts/) — каждый тип SSE-события, тип postMessage и форма route — это литерал оттуда. |
| **License** | Apache-2.0 |

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

> Вы приносите аккаунт Cloudflare; ваши пользователи приносят свои LLM key. Мы не держим хостед SaaS.

```bash
npm run cf:provision    # один раз: wrangler login + создать D1 / R2 + применить schema
npm run deploy          # каждый раз: ship Worker (API) + Pages (SPA)
```

После того как `npm run deploy` отработает, у вас будут `https://open-design-web.pages.dev` (SPA) и `https://open-design-api.<your-subdomain>.workers.dev` (API).

Что делает `cf:provision` за один заход: логинит вас в Cloudflare (пропускает, если уже залогинены), создаёт D1-базу `open-design` и записывает её `database_id` обратно в [`apps/api/wrangler.toml`](apps/api/wrangler.toml), создаёт R2 bucket `open-design-blobs`, применяет D1 schema.

Что делает `deploy`: деплоит Worker, vendor-ит UMD-bundle React + Babel в `apps/web/public/vendor/`, чтобы предпросмотры работали offline / за firewall / при строгом CSP, билдит SPA, шипит на Cloudflare Pages (проект `open-design-web`).

Или используйте встроенный GitHub Action — push в `main` триггерит `.github/workflows/deploy.yml`, как только вы добавите `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` в repo secrets (без них workflow no-op-ит, поэтому fork репозитория безопасен).

### Свой домен

В дашборде Cloudflare прицепите свой домен к Pages-проекту (например, `design.example.com`) и к Worker (например, `api.design.example.com`). SPA ожидает, что `/api/*` доходит до Worker — настройте Pages Function route или Cloudflare Routes UI rewrite для этого пути.

Добавьте origin SPA в `ALLOWED_ORIGINS` `[vars]` Worker-а в [`apps/api/wrangler.toml`](apps/api/wrangler.toml) (через запятую), затем перезадеплойте Worker — иначе CORS будет блокировать запросы.

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

PR-ы приветствуются. Проект в pre-alpha, и планка для контрибьюции низкая — поправьте опечатку, заведите баг, набросайте feature.

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
