# Open Claude Design

> **[Claude Design](https://claude.ai/design)을 순수 웹 앱 형태의 오픈소스로 재현한 프로젝트입니다.** Chat 기반의 멀티 파일 React prototyping에 **Tweaks · Comment · Edit · Draw** 네 가지 인플레이스 미리보기 도구를 더했습니다. Agent는 여러분의 브라우저 tab 안에서 실행되고, 단일 Cloudflare Worker (D1 + R2)가 파일을 보관합니다. Electron도, 로컬 daemon도, 서버 측 LLM 프록시도 없습니다.

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Status" src="https://img.shields.io/badge/status-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/stack-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#로컬-개발"><img alt="Local dev" src="https://img.shields.io/badge/local%20dev-1%20command-green?style=flat-square" /></a>
  <a href="#cloudflare-셀프호스트"><img alt="Self-host" src="https://img.shields.io/badge/self--host-1%20command-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <b>한국어</b> · <a href="README.es-ES.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">만든이: <a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **상태: pre-alpha.** 아키텍처는 안정화되었고 네 가지 미리보기 도구가 end-to-end로 동작하지만, 어느 release에서든 breaking change가 발생할 수 있습니다. wire 포맷에 의존한다면 commit을 고정하세요.

## 왜 이 프로젝트가 존재하는가

Anthropic의 [Claude Design](https://claude.ai/design)은 LLM을 인터랙티브 디자인 산출물을 ship하는 도구로 변모시켰습니다. chat을 입력하면 멀티 파일 React prototype이 나오고, 어떤 요소든 즉석에서 수정해서 ship할 수 있습니다. 단번에 화제가 되었지만, closed-source, 유료, 클라우드 전용, Anthropic 스택에 종속된 상태로 남았습니다.

**Open Claude Design은 그 표면을 충실하게 복제한 오픈소스이며, 기술적 뼈대도 동일합니다.** 트레이드오프가 발생하는 모든 지점에서, 우리는 Anthropic이 실제로 ship한 결과물을 우선적으로 참고했습니다 — artifact 포맷, `EDITMODE` Tweaks 블록, `<uuid>::verifier` 서브 agent 명명 규약, iframe 내부의 Babel-Standalone 미리보기 경로, 네 가지 도구의 `postMessage` 문법(`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …)까지. 이 코드베이스의 가장 큰 단일 입력은 Anthropic이 공개한 결과물을 읽어내는 일입니다.

**Claude Design과 마찬가지로, agent loop는 브라우저 tab 안에 머무르며 chat / 파일 / 프로젝트 상태는 여러분의 백엔드와 동기화됩니다.** 이것이 원작과의 가장 중요한 구조적 정렬 지점입니다 — Anthropic의 클라우드는 LLM passthrough + 도구 실행 + 프로젝트 스냅샷 저장소 역할만 하고, agent loop 자체는 브라우저 SPA 안에서 돕니다. 우리도 똑같이 합니다: [Vercel AI SDK](https://github.com/vercel/ai)의 tool loop가 여러분의 tab에서 돌고, chat / 파일 / 프로젝트 상태는 Cloudflare Worker를 거쳐 D1 + R2로 흘러가며, Worker는 여러분의 prompt를 결코 보지 못합니다. 이 **web-agent + backend-storage** 형태는 또한 SaaS로 진화하기에 자연스러운 모양이기도 합니다.

## 아키텍처

> 이 섹션은 코드베이스의 암묵적 spec입니다. 결과는 2026-04 동안 `claude.ai/design`에 로그인한 상태로 진행한 조사에서 얻어낸 것입니다 — DOM inspection, 네트워크 capture, 전역 변수 read, 다운로드 받은 artifact, deobfuscate한 런타임, 그리고 동작하는 POC. 직접 관찰된 사실에 충실하려고 노력했습니다.

### Claude Design의 모습

Claude Code와 같은 모양: 브라우저가 agent를 호스팅하고, 클라우드는 LLM gateway + tool 백엔드 역할만 합니다. 단일 turn의 Chat 요청 본문은 Anthropic Messages API의 직접 passthrough입니다 (full system + tools + 모든 message가 클라이언트 측에서 조립). 클라우드 `OmeletteService`는 **conversation state를 유지하지 않습니다** — LLM에 relay하고, tool을 실행하고, 프로젝트 스냅샷을 저장할 뿐입니다.

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

#### 핵심 관찰 사항

| 차원 | 실제로 ship되고 있는 것 |
|---|---|
| 메인 앱 프론트엔드 | Vite + React Router v6 + styled-components; 코드 에디터는 네이티브 `<textarea>` + 직접 만든 `<div>` 줄 번호 — Monaco도, CodeMirror도 없음 |
| 백엔드 프로토콜 | Connect / gRPC-Web + Protobuf; service 이름은 `anthropic.omelette.api.v1alpha.OmeletteService` |
| Agent tool 프로토콜 | MCP (Model Context Protocol) — `defer_loading` 필드를 가진 완전한 `tools/list` payload를 capture; 서드파티 MCP 서버가 실제로 plug in 됨 |
| Tool 라우팅 | 30+ tool이 9개 bucket으로 dispatch: 클라우드 RPC (EditFile / GetFile / …) / 로컬 FSA (local_*) / iframe DOM (show_html / eval_js / screenshot) / pure 클라이언트 로직 (snip / update_todos) / spawn된 sub-agent / 서드파티 MCP / LLM 빌트인 (web_search / web_fetch) |
| Verifier sub-agent | 메인 agent의 **system prompt + toolset + history**를 공유; fork 자체는 fork tool_result에 박힌 role-reset prompt + sessionUUID에 붙은 `::verifier` suffix + max_tokens가 절반으로 줄어든 것 뿐 |
| 미리보기 iframe | 각 프로젝트가 독립 서브도메인 `{project-uuid}.claudeusercontent.com` 위에서 실행; 메인 사이트는 CSP `default-src 'none'; frame-ancestors 'none'`을 설정; 미리보기 token은 4 segment: `{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}` |
| 생성된 artifact 런타임 | React **18.3.1** + Babel Standalone **7.29.0** (UMD, integrity-hash 고정) + 인라인 `style={{...}}` JS 객체 + Google Fonts + 멀티 JSX `<script type="text/babel" src="*.jsx">`를 전역 window에 마운트 |
| Tweaks 프로토콜 | Artifact가 `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` 블록을 임베드하고 + `EDIT_STYLE` postMessage로 모델을 다시 돌리지 않고도 라이브로 다시 써냄 |
| 클라이언트 권위 저장소 | 브라우저가 모든 chats / messages / contentBlocks / tool I/O / viewState / assets manifest를 보유하고, `UpdateProjectData`로 완전한 스냅샷을 다시 push. **모든 tool call의 input/output이 영속화됨** |
| `done` 복합 op | EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData의 chain을 트리거 |
| Streaming | 네이티브 Anthropic SSE가 아님 — OmeletteService가 custom frame으로 다시 wrap: `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` |
| 로컬 폴더 브릿지 | File System Access API + 4개의 `local_*` tool (local_ls / local_read / local_grep / local_copy_to_project); 로컬 파일은 OmeletteService에 **절대** 도달하지 않음 — LLM context에만 등장 |

### Open Claude Design의 모습

위 다이어그램을 그대로 가져옵니다: agent loop는 브라우저, 클라우드는 storage 전용. 전체 모양은 원작과 정렬되며, 엔지니어링 트레이드오프 위에서만 단순화합니다 (Connect / gRPC-Web 대신 HTTP REST, 자체 백엔드 대신 Cloudflare Worker, 호스팅 key 대신 BYOK).

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

#### 원작에서 그대로 유지하는 것

- **브라우저 측 agent loop** — Vercel AI SDK의 `ToolLoopAgent`가 tab 안에서 실행 (원작의 agent framework는 비공개지만 host 위치는 동일)
- **클라이언트 권위 + 백엔드 스냅샷** — D1이 프로젝트 메타데이터를 보유, R2가 sha256 content-addressed blob을 보유, 전체 스냅샷으로 작성됨
- **미리보기 iframe 런타임** — React 18.3.1 + Babel Standalone 7.29.0, 동일한 버전 + integrity hash, 멀티 JSX entry 시맨틱 그대로 보존
- **프로토콜 리터럴** — Tweaks `EDITMODE-BEGIN/END`, `SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` 같은 postMessage 타입, `<uuid>::verifier` 서브 agent 명명 규약 — 모두 verbatim 유지

#### 의도적으로 갈라지는 것

- **Wire 프로토콜** — Connect / gRPC-Web에서 HTTP REST + SSE로 단순화 (스키마는 [`packages/contracts`](packages/contracts/)에 있고, `.proto` 재사용 없음)
- **폰트** — 상용 Anthropic Serif 대신 Google Fonts (Inter / Instrument Serif / JetBrains Mono); 아이콘은 Lucide
- **미리보기 서브도메인** — `*.claudeusercontent.com` 대신 Cloudflare Pages 기본 서브도메인 (셀프호스트 시 본인 도메인을 가져오면 됨)
- **로컬 폴더 브릿지 / 서드파티 MCP / verifier sub-agent** — 아직 미구현 (로드맵)

## nexu-io/open-design 및 OpenCoworkAI/open-codesign과의 차이점

세 프로젝트 모두 Claude Design의 오픈소스 재현입니다. 갈림은 주로 **agent loop가 어디에서 돌고, chat / 파일이 어디에 안착하느냐**에 있습니다.

|  | Claude Design (원작) | [open-codesign][ocod] | [nexu-io/open-design][nexu] | **Open Claude Design** |
|---|---|---|---|---|
| 형태 | Web (claude.ai) | Desktop (Electron) | Web app + 로컬 daemon | **순수 웹 + Cloudflare Workers** |
| Agent loop가 도는 곳 | 브라우저 tab | Electron 메인 프로세스 안, [pi-ai] 번들 | 디스크에 이미 있는 CLI (Claude Code / Codex / Cursor / Gemini / … 13개 어댑터) | **브라우저 tab (Vercel AI SDK ToolLoopAgent, BYOK)** |
| Chat / 파일이 사는 곳 | 클라우드 (OmeletteService + content-addressed blob) | 로컬 SQLite + 로컬 파일시스템 | 로컬 SQLite + 로컬 파일시스템 | **Cloudflare D1 + R2 (여러분의 계정)** |
| 로컬 CLI / 데스크톱 셸 필요? | 아니오 | 예 (Electron 인스톨러) | 예 (npm + 13개 CLI 중 하나) | **아니오 — 브라우저로 페이지 열기만** |
| 원작과의 구조적 충실도 | 100% | 중간 (agent가 데스크톱 런타임에 있음, 웹 아님) | 중간 (agent가 사용자 CLI에 있음, daemon이 spawn) | **높음 — agent는 브라우저, 백엔드는 storage, 원작과 같은 모양** |
| 라이선스 | Closed | MIT | Apache-2.0 | Apache-2.0 |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

요약하면: **open-codesign과 nexu-io는 local-first (agent가 데스크톱 또는 사용자 CLI에 있고, 파일은 디스크에); 우리와 원작 Claude Design은 web-first (agent는 브라우저, 파일은 클라우드 백엔드)**. 각각 트레이드오프가 있고, 우리는 Anthropic이 실제로 ship한 것에 가장 구조적으로 정렬된 길을 골랐습니다.

## 감사의 말

이 프로젝트는 많은 사람들의 작업 위에 서 있습니다.

**[Anthropic의 Claude Design](https://claude.ai/design)**은 Open Claude Design이 재현하고자 하는 제품입니다. 원작팀이 만들어낸 결과물과 그들이 세운 기준에 진심으로 경의를 표합니다 — 경험의 모든 레이어에서 그들이 얼마나 공을 들였는지가 드러납니다. 이 코드베이스는 그 기준에 다가가려는 과정 그 자체입니다.

같은 방향에서 작업해 온 두 오픈소스 프로젝트에도 감사를 전하고 싶습니다:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — 이 방향에 쏟아부은 견고하고 깊이 있는 오픈소스 엔지니어링에 감사드립니다.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — 동일한 문제에 대한 자신들의 오픈소스 구현을 솔직하게 공개해 주신 데 감사드립니다.

이들 덕분에 "오픈소스 재현"이라는 주제의 논의가 더 풍부해졌고, 이 두 프로젝트의 존재에 진심으로 감사드립니다.

### 도구 체계

- [Vercel AI SDK](https://github.com/vercel/ai) — 멀티 provider 추상화로, agent 루프가 브라우저 tab 안에서 돌 수 있게 해줍니다.
- [React](https://react.dev/)와 [Babel](https://babeljs.io/) — UMD build로 iframe 내부 미리보기 런타임을 떠받칩니다.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/) — 운영할 서버가 없는 백엔드.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/), 그리고 더 넓은 TypeScript / npm-workspaces 도구 체계.

## 면책조항

Open Claude Design 은 커뮤니티 주도의 오픈 소스 재현 프로젝트입니다. **본 프로젝트는 Anthropic 과 제휴, 인증, 후원 관계가 없습니다.** "Claude" 와 "Claude Design" 은 Anthropic, PBC 의 상표입니다.

agent 의 행동 지침 중 일부 — 구체적으로 [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) 하위의 system prompt 내용 — 은 Anthropic 이 공개한 Claude Design 런타임을 관찰하여 각색한 것입니다. 「fair use / 상호 운용성」을 근거로, 오픈 소스 재현이 원작 표면에 최대한 충실하도록 이 내용을 보존하고 있습니다.

**Anthropic 측에서 어떤 내용이라도 삭제 또는 재작성을 요청하시면 즉시 대응하겠습니다** — [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) 에서 issue 를 열어주시거나 저장소 메인테이너에게 연락해 주세요.

## 무엇을 할 수 있는가

- **Chat → 생성**: 멀티 파일 React prototype을 token-by-token streaming으로 프로젝트 워크스페이스에 떨어뜨립니다.
- **Tweaks**: artifact가 자체 정의한 디자인 token이 실시간 슬라이더 / 컬러 피커로 변환되어 — 즉석에서 조정, 재 prompt 없음.
- **Comment**: 미리보기의 특정 좌표에 pin을 찍어 어노테이션을 작성하고, pin 컨텍스트를 agent로 되돌려 타깃 리라이팅에 활용합니다.
- **Edit**: 임의의 요소를 클릭하고, 플로팅 인스펙터에서 inline 스타일이나 Tailwind 클래스를 수정하면 변경이 소스 파일로 영구 반영됩니다.
- **Draw**: 미리보기 위에 손으로 스케치하면, 획 + 스크린샷이 다음 턴 입력이 되어 모델이 그 단서에 맞춰 동작합니다.
- **멀티 파일 프로젝트**(`.jsx` / `.html` / `.css`)를 Babel Standalone으로 샌드박스 iframe에서 렌더링 — entry 파일은 `.html` > `.jsx`/`.tsx` 우선순위로 결정됩니다.
- **Importable** — Claude Design이 export한 ZIP을 워크스페이스에 드래그하면, Anthropic이 멈춘 지점부터 이어서 편집할 수 있습니다.

## 기술 스택

- **프론트엔드** — Vite + React 18.3.1 + React Router v6 + styled-components
- **백엔드** — [Hono](https://hono.dev/) on Cloudflare Workers
- **저장소** — Cloudflare D1(메타데이터) + R2(sha256 콘텐츠 어드레싱 blob)
- **AI** — [Vercel AI SDK](https://github.com/vercel/ai)의 `ToolLoopAgent`가 브라우저에서 실행, 사용자 key로 OpenRouter 또는 10개 1티어 provider를 직접 호출
- **Wire** — HTTP REST + SSE, schema는 [`packages/contracts`](packages/contracts/)에 잠겨 있음
- **테스트** — Vitest(unit + integration) + Playwright(e2e)

## 로컬 개발

**전제**: Node 22+, npm 10+. Cloudflare 계정 불필요 — `wrangler`의 `--local` 모드는 `.wrangler/state/` 아래 SQLite 파일을 사용합니다.

아래 블록 전체를 새 터미널에 복사하세요:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # 첫 실행은 약 1분: 의존성 설치 + D1 migration 적용
npm run dev      # web :5173, api :8787 (Ctrl-C로 중지)
```

dev server가 올라오면 <http://localhost:5173>을 엽니다. 첫 chat을 보낼 때 OpenRouter API key를 붙여넣으라고 요청합니다 — [openrouter.ai/keys](https://openrouter.ai/keys)에서 발급하세요. Key는 브라우저 `localStorage`에만 저장됩니다; 삭제하거나 교체하려면 언제든 `/settings`로 이동하세요.

이후 실행에서는 `npm run dev` 한 줄이면 됩니다 — `setup`은 일회성입니다.

> Sanity check: `curl http://localhost:8787/health` → `200 {"ok":true,...}`.

## Cloudflare 셀프호스트

> Cloudflare 계정은 여러분이 마련하고, LLM key는 여러분의 사용자가 마련합니다.

```bash
npm run cf:provision    # 일회성: wrangler login + D1 / R2 생성 + schema 적용
npm run deploy          # 매번: Worker(API) + Pages(SPA) deploy
```

`npm run deploy`가 끝나면 `https://open-design-web.pages.dev`(SPA)와 `https://open-design-api.<your-subdomain>.workers.dev`(API)를 받게 됩니다.

`cf:provision`이 한 번에 처리하는 일: Cloudflare에 자동 로그인(이미 로그인되어 있으면 건너뜀), `open-design` D1 데이터베이스 생성 후 `database_id`를 [`apps/api/wrangler.toml`](apps/api/wrangler.toml)에 다시 기록, `open-design-blobs` R2 bucket 생성, D1 schema를 적용.

`deploy`가 한 번에 처리하는 일: Worker deploy, React + Babel UMD bundle을 `apps/web/public/vendor/`로 vendor(미리보기가 오프라인 / 사내망 / 엄격한 CSP에서도 동작하도록), SPA build, Cloudflare Pages(`open-design-web` 프로젝트)로 푸시.

또는 내장 GitHub Action을 그대로 쓸 수도 있습니다 — `main`에 push하면 `.github/workflows/deploy.yml`이 트리거되며, 전제 조건은 repo secrets에 `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`를 추가해 두는 것입니다. 둘이 빠지면 workflow가 no-op이 되므로, fork된 repo가 터지지 않습니다.

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

PR 환영합니다. 프로젝트는 pre-alpha 단계라 기여 문턱이 낮습니다.

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
