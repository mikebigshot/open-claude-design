# Open Claude Design

> **[Claude Design](https://claude.ai/design)을 순수 웹 앱 형태의 오픈소스로 재현한 프로젝트입니다.** Agent 기반 prototype 디자인 워크벤치로, **Tweaks · Comment · Edit · Draw** 네 가지 인플레이스 미리보기 도구를 제공합니다. Agent는 브라우저 tab 안에서 실행되고, 파일은 단일 Cloudflare Worker (D1 + R2)가 보관합니다. Electron도, 로컬 daemon도, 서버 측 LLM 프록시도 없습니다.

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Status" src="https://img.shields.io/badge/상태-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/기술-스택-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#로컬-개발"><img alt="로컬 개발" src="https://img.shields.io/badge/로컬-개발-한-블록-복사-green?style=flat-square" /></a>
  <a href="#cloudflare-셀프호스트"><img alt="셀프호스트" src="https://img.shields.io/badge/셀프호스트-한-블록-복사-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <b>한국어</b> · <a href="README.es-ES.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">만든이: <a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **상태: pre-alpha.** 아키텍처는 안정화되었고 네 가지 미리보기 도구가 end-to-end로 동작하지만, wire 프로토콜은 어떤 release에서든 breaking change가 발생할 수 있습니다. 프로토콜 리터럴에 의존한다면 버전을 고정하세요.

## 왜 이 프로젝트가 존재하는가

Anthropic의 [Claude Design](https://claude.ai/design)은 LLM을 인터랙티브 디자인 산출물을 전달하는 도구로 변모시켰습니다. chat을 입력하면 멀티 파일 React prototype이 나오고, 어떤 요소든 즉석에서 수정해서 ship할 수 있습니다. 단번에 화제가 되었지만, **closed-source**, 유료, 클라우드 전용, Anthropic 스택에 종속된 상태로 남았습니다.

**Open Claude Design은 그 표면을 충실하게 복제한 오픈소스이며, 기술적인 뼈대도 공식 구현과 정렬되어 있습니다.** 트레이드오프가 발생하는 모든 지점에서, 우리는 Anthropic이 실제로 ship한 결과물을 우선적으로 참고했습니다 — artifact 포맷, `EDITMODE` Tweaks 블록, `<uuid>::verifier` 서브 agent 명명 규약, iframe 내부의 Babel Standalone 렌더링, 네 가지 도구의 `postMessage` 문법(`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …)까지. 이 코드베이스의 가장 큰 단일 입력은 Anthropic이 이미 가동 중인 런타임을 읽어내는 일입니다.

우리가 Claude Design과 갈라지는 방향은 하나입니다: **순수 웹, 외부 셸 없음, SaaS 아님.** 제품 전체가 브라우저 tab + 단일 Cloudflare Worker 위에서 돌아갑니다. Chat agent([Vercel AI SDK](https://github.com/vercel/ai)의 tool-loop)가 **여러분의 브라우저 tab 안에서** 실행되며, 여러분의 key로 OpenRouter를 직접 호출합니다 — Worker는 저장만 담당하고, 여러분의 prompt를 결코 보지 못합니다. 이 트레이드오프가 다음 세 가지를 가져다줍니다:

1. **무료 Cloudflare 계정 한 번의 명령으로 셀프호스트** — Postgres도, Redis도, ECS도, Docker도 없습니다.
2. **계정도, 공유 SaaS도, 쿼터도 없음** — fork, deploy, 친구에게 링크를 보내세요.
3. **다 읽을 수 있는 코드** — strict TS, npm workspaces, 약 10개 소스 폴더. 가장 흥미로운 부분(iframe runtime, `EDITMODE` 프로토콜, 브라우저 측 agent 루프)은 주말 한 번이면 다 읽을 수 있습니다.

## 감사의 말

이 프로젝트는 많은 사람들의 작업 위에 서 있습니다.

**[Anthropic의 Claude Design](https://claude.ai/design)**은 Open Claude Design이 재현하고자 하는 제품입니다. 원작팀이 만들어낸 결과물과 그들이 세운 기준에 진심으로 경의를 표합니다 — 경험의 모든 레이어에서 그들이 얼마나 공을 들였는지가 드러납니다. 이 코드베이스는 그 기준에 다가가려는 과정 그 자체입니다.

같은 방향에서 작업해 온 두 오픈소스 프로젝트에도 감사를 전하고 싶습니다:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — 이 방향에 쏟아부은 견고하고 깊이 있는 오픈소스 엔지니어링에 감사드립니다.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — 동일한 문제에 대한 자신들의 오픈소스 구현을 솔직하게 공개해 주신 데 감사드립니다.

이들 덕분에 "오픈소스 재현"이라는 주제의 논의가 더 풍부해졌고, 이 두 프로젝트의 존재에 진심으로 감사드립니다.

### 도구 체계

- [Vercel AI SDK](https://github.com/vercel/ai) — 멀티 provider 추상화로, agent 루프가 브라우저 tab 안에서 돌 수 있게 해줍니다.
- [OpenRouter](https://openrouter.ai/) — BYOK key 하나로 수십 개의 LLM provider를 모두 사용합니다.
- [React](https://react.dev/)와 [Babel](https://babeljs.io/) — UMD build로 브라우저 내 미리보기 런타임을 떠받칩니다.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/) — 서버리스 백엔드.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/), 그리고 더 넓은 TypeScript / npm-workspaces 도구 체계.

## 면책조항

Open Claude Design 은 커뮤니티 주도의 오픈 소스 재현 프로젝트입니다. **본 프로젝트는 Anthropic 과 제휴, 인증, 후원 관계가 없습니다.** "Claude" 와 "Claude Design" 은 Anthropic, PBC 의 상표입니다.

agent 의 행동 지침 중 일부 — 구체적으로 [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) 하위의 system prompt 내용 — 은 Anthropic 이 공개한 Claude Design 런타임을 관찰하여 각색한 것입니다. 「fair use / 상호 운용성」을 근거로, 오픈 소스 재현이 원작 표면에 최대한 충실하도록 이 내용을 보존하고 있습니다.

**Anthropic 측에서 어떤 내용이라도 삭제 또는 재작성을 요청하시면 즉시 대응하겠습니다** — [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) 에서 issue 를 열어주시거나 저장소 메인테이너에게 연락해 주세요.

## 한눈에 보기

| | 받게 되는 것 |
|---|---|
| **형태** | 순수 웹 — Vite SPA + 단일 Cloudflare Worker. Electron / 로컬 daemon / 네이티브 인스톨러 없음. |
| **AI 런타임** | Vercel AI SDK의 `ToolLoopAgent`가 **브라우저 tab 안에서** 실행. Tools(`edit_file` / `read_file` / `list_files` / `mark_done`)가 Worker의 REST API를 호출해 파일을 디스크에 저장; Worker는 prompt나 key를 결코 보지 못합니다. |
| **Provider** | OpenRouter가 기본 fan-out(key 하나로 Anthropic / OpenAI / Google / Mistral / xAI / DeepSeek / Groq / Cerebras …를 모두 사용). 직접 SDK 연결도 모두 갖춰져 있습니다: `@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}`, 그리고 임의의 OpenAI 호환 endpoint. Key는 모두 `localStorage`에 보관됩니다. |
| **저장소** | Cloudflare **D1**(SQLite)에 메타데이터 + **R2**에 sha256 콘텐츠 어드레싱 파일 blob. 단일 Worker가 둘 모두를 바인딩. 무료 쿼터로 대부분의 개인 프로젝트를 충분히 감당합니다. |
| **미리보기 표면** | 샌드박스 iframe에서 React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 실행 — 순수 문자열 결합으로 만든 `srcdoc`로 로딩. React / npm 런타임 의존성이 미리보기로 새지 않습니다. 프로덕션 / 오프라인 / 엄격한 CSP 시나리오를 위해 UMD bundle을 vendor할 수 있습니다. |
| **Tweaks** | Artifact 내부에 `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` 블록을 임베드해 조정 가능한 디자인 token을 선언합니다. 호스트 UI가 이를 슬라이더 / 컬러 피커로 렌더링하고, 변경 사항은 `EDIT_STYLE` postMessage로 실시간 반영되며 모델을 재실행하지 않습니다. |
| **Comment** | 미리보기 위 어디든 pin을 찍어 코멘트를 작성하고, pin 컨텍스트를 agent에 넘겨 타깃 리라이팅을 수행합니다. |
| **Edit** | 임의의 DOM 요소를 클릭 — 인스펙터가 떠오르고, inline 스타일이나 Tailwind 클래스명을 수정하면 변경이 프로젝트 소스 파일에 영구 반영됩니다. |
| **Draw** | 펜 도구로 미리보기 위에 드로잉; 획 + 스크린샷이 다음 턴의 입력이 되어, 손으로 그린 단서대로 모델이 수정합니다. |
| **Wire 프로토콜** | HTTP REST + Server-Sent Events. 단일 출처는 [`packages/contracts`](packages/contracts/) — 모든 SSE 이벤트 타입, postMessage 타입, 라우트 shape이 여기 리터럴로 박혀 있습니다. |
| **License** | Apache-2.0 |

## 무엇을 할 수 있는가

- **Chat → 생성**: 자연어 설명 → AI가 멀티 파일 React prototype을 streaming으로 생성하고, token이 나오는 대로 워크스페이스에 떨어집니다.
- **Tweaks**: artifact가 자체 선언한 디자인 token이 실시간 슬라이더 / 컬러 피커로 변환되어 — 즉석에서 조정, 재 prompt 없음.
- **Comment**: 미리보기의 특정 좌표에 pin을 찍어 코멘트를 적고, pin 컨텍스트를 agent로 되돌려 타깃 리라이팅에 활용합니다.
- **Edit**: 요소를 클릭하고, 플로팅 인스펙터에서 inline 스타일이나 Tailwind 클래스를 수정하면 변경이 소스 파일로 반영됩니다.
- **Draw**: 미리보기 위에 손으로 스케치하면, 획 + 스크린샷이 다음 턴 입력이 되어 모델이 그 그림에 맞춰 수정합니다.
- **멀티 파일 프로젝트**(`.jsx` / `.html` / `.css`)를 Babel Standalone으로 샌드박스 iframe에서 렌더링 — entry 파일은 `.html` > `.jsx`/`.tsx` 우선순위로 결정됩니다.
- **Importable** — Claude Design이 export한 ZIP을 워크스페이스에 드래그하면, agent가 Anthropic이 멈춘 지점부터 이어서 편집합니다.

## 기술 스택

- **프론트엔드** — Vite + React 18.3.1 + React Router v6 + styled-components
- **백엔드** — [Hono](https://hono.dev/) on Cloudflare Workers
- **저장소** — Cloudflare D1(메타데이터) + R2(sha256 콘텐츠 어드레싱 blob)
- **AI** — [Vercel AI SDK](https://github.com/vercel/ai)의 `ToolLoopAgent`가 브라우저에서 실행, 사용자 key로 OpenRouter / 10개 1티어 provider를 직접 호출
- **Wire** — HTTP REST + SSE, schema는 [`packages/contracts`](packages/contracts/)에 잠겨 있음
- **테스트** — Vitest(unit + integration) + Playwright(e2e)

## 로컬 개발

**전제**: Node 22+, npm 10+. **Cloudflare 계정 불필요** — `wrangler`의 `--local` 모드는 `.wrangler/state/` 아래 로컬 SQLite를 사용합니다.

아래 블록 전체를 새 터미널에 복사하세요:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # 첫 실행은 약 1분: 의존성 설치 + D1 migration 적용
npm run dev      # web :5173, api :8787 (Ctrl-C로 중지)
```

dev server가 올라오면 <http://localhost:5173>을 엽니다. 첫 chat을 보낼 때 OpenRouter API key를 붙여넣으라고 요청합니다 — [openrouter.ai/keys](https://openrouter.ai/keys)에서 발급하세요. Key는 브라우저 `localStorage`에만 저장됩니다; 삭제하거나 교체하려면 `/settings`로 이동하세요.

이후 실행에서는 `npm run dev` 한 줄이면 됩니다 — `setup`은 일회성입니다.

> Sanity check: `curl http://localhost:8787/health` → `200 {"ok":true,...}`.

## Cloudflare 셀프호스트

> Cloudflare 계정은 여러분이 마련하고, LLM key는 여러분의 사용자가 마련합니다. 우리는 호스팅 SaaS를 운영하지 않습니다.

```bash
npm run cf:provision    # 일회성: wrangler login + D1 / R2 생성 + schema 적용
npm run deploy          # 매번: Worker(API) + Pages(SPA) deploy
```

`npm run deploy`가 끝나면 `https://open-design-web.pages.dev`(SPA)와 `https://open-design-api.<your-subdomain>.workers.dev`(API)를 받게 됩니다.

`cf:provision`이 한 번에 처리하는 일: Cloudflare에 자동 로그인(이미 로그인되어 있으면 건너뜀), `open-design` D1 데이터베이스 생성 후 `database_id`를 [`apps/api/wrangler.toml`](apps/api/wrangler.toml)에 다시 기록, `open-design-blobs` R2 bucket 생성, D1 schema를 원격에 적용.

`deploy`가 한 번에 처리하는 일: Worker deploy, React + Babel UMD bundle을 `apps/web/public/vendor/`로 vendor(미리보기가 오프라인 / 사내망 / 엄격한 CSP에서도 동작하도록), SPA build, Cloudflare Pages(`open-design-web` 프로젝트)로 푸시.

또는 내장 GitHub Action을 그대로 쓸 수도 있습니다 — `main`에 push하면 `.github/workflows/deploy.yml`이 트리거되며, 전제 조건은 repo secrets에 `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`를 추가해 두는 것입니다(둘이 빠지면 workflow가 no-op이 되므로, fork된 repo가 터지지 않습니다).

### 커스텀 도메인

Cloudflare 대시보드에서 Pages 프로젝트에 커스텀 도메인(예: `design.example.com`)을 붙이고, Worker에는 별도 도메인(예: `api.design.example.com`)을 붙입니다. SPA는 `/api/*`가 worker로 도달할 것을 기대합니다 — Pages Function route나 Cloudflare Routes UI로 해당 path를 리라이트하세요.

SPA의 origin을 Worker의 [`apps/api/wrangler.toml`](apps/api/wrangler.toml) `[vars] ALLOWED_ORIGINS`에 추가(쉼표 구분)한 뒤 Worker를 재 deploy하세요. 그렇지 않으면 CORS가 요청을 거부합니다.

## 저장소 구조

```
open-claude-design/
├── apps/
│   ├── web/                — 프론트엔드 (Vite + React + styled-components)
│   │   └── src/features/
│   │       ├── chat/       — 브라우저 측 ToolLoopAgent + tools + system prompts
│   │       ├── preview/    — Iframe + Tweaks/Comment/Edit/Draw 오버레이
│   │       ├── workspace/  — 멀티 tab 파일 워크스페이스 + 프로젝트 상태
│   │       ├── home/       — 홈, 프로젝트 선택기, 예제 갤러리
│   │       └── settings/   — BYOK key 관리
│   └── api/                — 백엔드 (Hono on Cloudflare Workers + D1 + R2)
├── packages/
│   ├── contracts/          — 프론트/백엔드 공유 TypeScript wire 계약 (단일 출처)
│   ├── design-tokens/      — color / typography token (TS + CSS 듀얼 소스)
│   └── iframe-runtime/     — Iframe에 주입하는 오버레이 + Tweaks 브릿지 (런타임 의존성 0, 순수 문자열 결합)
└── e2e/                    — Playwright end-to-end 테스트
```

## 기여

PR 환영합니다. 프로젝트는 pre-alpha 단계라 기여 문턱이 낮습니다 — typo 수정, bug 보고, feature 스케치 무엇이든 좋습니다.

```bash
npm install
npm run typecheck   # 워크스페이스 전체에 tsc --noEmit
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright (먼저 `npm run dev`가 떠 있어야 함)
```

브랜치 전략, commit 컨벤션, 신규 기여자를 위한 코드 리딩 경로는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## License

[Apache License 2.0](LICENSE) — fork, 수정, ship.
