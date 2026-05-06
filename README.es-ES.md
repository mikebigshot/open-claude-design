# Open Claude Design

> **Una recreación open-source de [Claude Design](https://claude.ai/design) como aplicación puramente web.** Workbench de prototipos React multi-archivo dirigido por chat, con cuatro herramientas de previsualización in situ — **Tweaks · Comment · Edit · Draw**. El agent corre en tu tab del navegador; un único Cloudflare Worker (D1 + R2) guarda los archivos. Sin Electron, sin daemon local, sin proxy LLM en el servidor.

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Estado" src="https://img.shields.io/badge/estado-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/stack-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#desarrollo-local"><img alt="Desarrollo local" src="https://img.shields.io/badge/desarrollo%20local-pega%20un%20bloque-green?style=flat-square" /></a>
  <a href="#self-host-en-cloudflare"><img alt="Self-host" src="https://img.shields.io/badge/self--host-pega%20un%20bloque-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <b>Español</b> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">Por <a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **Estado: pre-alpha.** La arquitectura ya está estable y las cuatro herramientas de previsualización funcionan de extremo a extremo, pero cualquier release puede traer breaking changes. Si dependes de los literales del wire, fija una versión.

## Por qué existe este proyecto

[Claude Design](https://claude.ai/design) de Anthropic convirtió a un LLM en una herramienta que entrega artifacts de diseño interactivos: chateas, sale un prototipo React multi-archivo, editas cualquier elemento al vuelo, ship. Se hizo viral y se quedó **closed-source**, de pago, solo en la nube, atado al stack de Anthropic.

**Open Claude Design es una recreación open-source fiel de esa superficie, con los mismos huesos técnicos.** Donde tuvimos que elegir, nos remitimos a lo que Anthropic realmente publicó — el formato del artifact, el bloque `EDITMODE` de Tweaks, la convención de sub-agent `<uuid>::verifier`, el path de previsualización con Babel Standalone dentro del iframe, la gramática `postMessage` de las cuatro herramientas (`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …). El input más importante de este código fue leer lo que Anthropic ya tiene en producción.

**Igual que Claude Design, el agent loop vive en el tab del navegador y el chat / los archivos / el estado del proyecto se sincronizan con tu propio backend.** Este es el punto más importante de alineamiento estructural con el original — la nube de Anthropic es solo un passthrough de LLM + ejecución de tools + almacén de project-snapshots, y el agent loop en sí corre en la SPA del navegador. Nosotros hacemos lo mismo: el tool loop del [Vercel AI SDK](https://github.com/vercel/ai) corre en tu tab, mientras que el chat / los archivos / el estado del proyecto fluyen a través de un Cloudflare Worker hacia D1 + R2, y el Worker nunca ve tus prompts. Esta forma **web-agent + backend-storage** es además la forma exacta que escala hacia un SaaS.

## Arquitectura

> Esta sección es la spec implícita del código. Los hallazgos provienen de una investigación logueada de `claude.ai/design` durante 2026-04 — inspección del DOM, captura de red, lectura de variables globales, descarga de artifacts, runtime desofuscado y un POC funcional. Intentamos ceñirnos a hechos directamente observados.

### Cómo se ve Claude Design

La misma forma que Claude Code: el navegador hospeda al agent, la nube es solo un gateway de LLM + tool backend. El cuerpo del request Chat de un único turn es un passthrough directo a la Anthropic Messages API (system completo + tools + todos los messages, ensamblados del lado del cliente). El `OmeletteService` de la nube **no mantiene estado de conversación** — solo retransmite al LLM, ejecuta tools y almacena snapshots de proyecto.

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

#### Observaciones clave

| Dimensión | Lo que realmente está en producción |
|---|---|
| Frontend de la app principal | Vite + React Router v6 + styled-components; el editor de código es un `<textarea>` nativo más números de línea hechos a mano con `<div>` — sin Monaco, sin CodeMirror |
| Protocolo de backend | Connect / gRPC-Web + Protobuf; nombre del servicio `anthropic.omelette.api.v1alpha.OmeletteService` |
| Protocolo de tools del agent | MCP (Model Context Protocol) — capturamos un payload `tools/list` completo con el campo `defer_loading`; los servidores MCP de terceros sí se enchufan de verdad |
| Routing de tools | Más de 30 tools repartidas en 9 buckets: RPC en la nube (EditFile / GetFile / …) / FSA local (local_*) / DOM del iframe (show_html / eval_js / screenshot) / lógica pura del cliente (snip / update_todos) / sub-agent spawneado / MCP de terceros / built-in del LLM (web_search / web_fetch) |
| Sub-agent verifier | Comparte el **system prompt + toolset + history** del agent principal; el fork entero es solo un prompt de role-reset metido en el tool_result del fork + un sufijo `::verifier` en el sessionUUID + max_tokens reducido a la mitad |
| Iframe de preview | Cada proyecto en su propio subdominio `{project-uuid}.claudeusercontent.com`; el sitio principal fija CSP `default-src 'none'; frame-ancestors 'none'`; los preview tokens son 4 segmentos: `{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}` |
| Runtime de los artifacts generados | React **18.3.1** + Babel Standalone **7.29.0** (UMD, integrity-hash fijado) + objetos JS `style={{...}}` inline + Google Fonts + multi-JSX `<script type="text/babel" src="*.jsx">` montado sobre el window global |
| Protocolo Tweaks | Los artifacts incrustan bloques `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` + postMessage `EDIT_STYLE` para escribir en vivo, sin volver a correr el modelo |
| Storage client-authoritative | El navegador guarda el manifest completo de chats / messages / contentBlocks / tool I/O / viewState / assets, y empuja un snapshot completo de vuelta vía `UpdateProjectData`. **Cada input/output de tool call queda persistido** |
| Operación compuesta `done` | Dispara una cadena de EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData |
| Streaming | No es SSE nativo de Anthropic — OmeletteService lo re-empaqueta como frames custom: `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` |
| Bridge de carpeta local | File System Access API + 4 tools `local_*` (local_ls / local_read / local_grep / local_copy_to_project); los archivos locales **nunca** llegan a OmeletteService — solo aparecen en el contexto del LLM |

### Cómo se ve Open Claude Design

Trasladamos ese diagrama tal cual: agent loop en el navegador, la nube es solo storage. La forma global se alinea con el original; solo simplificamos por trade-offs de ingeniería (HTTP REST en vez de Connect / gRPC-Web, un Cloudflare Worker en vez de un backend custom, BYOK en vez de keys hosteadas).

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

#### Lo que conservamos del original

- **Agent loop del lado del navegador** — el `ToolLoopAgent` del Vercel AI SDK corre en el tab (el framework de agent del original no es público, pero el host es el mismo)
- **Client-authoritative + snapshot en el backend** — D1 guarda metadata del proyecto, R2 guarda blobs direccionados por sha256, escritos como snapshots completos
- **Runtime del iframe de preview** — React 18.3.1 + Babel Standalone 7.29.0, mismas versiones e integrity hashes, semántica de entries multi-JSX preservada
- **Literales del protocolo** — el `EDITMODE-BEGIN/END` de Tweaks, los tipos postMessage como `SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY`, la convención de naming `<uuid>::verifier` para el sub-agent — todo se mantiene textual

#### Dónde divergimos a propósito

- **Wire protocol** — simplificado de Connect / gRPC-Web a HTTP REST + SSE (schemas en [`packages/contracts`](packages/contracts/), sin reutilizar `.proto`)
- **Fuentes** — Anthropic Serif comercial reemplazada por Google Fonts (Inter / Instrument Serif / JetBrains Mono); iconos vía Lucide
- **Subdominio del preview** — `*.claudeusercontent.com` reemplazado por el subdominio por defecto de Cloudflare Pages (trae tu propio dominio en self-host)
- **Bridge de carpeta local / MCP de terceros / sub-agent verifier** — todavía no implementados (roadmap)

## Diferencias con nexu-io/open-design y OpenCoworkAI/open-codesign

Los tres proyectos son recreaciones open-source de Claude Design. La separación tiene que ver mayormente con **dónde corre el agent loop y dónde acaban el chat / los archivos**.

|  | Claude Design (original) | [open-codesign][ocod] | [nexu-io/open-design][nexu] | **Open Claude Design** |
|---|---|---|---|---|
| Forma | Web (claude.ai) | Desktop (Electron) | App web + daemon local | **Puro web + Cloudflare Workers** |
| Dónde corre el agent loop | Tab del navegador | Dentro del proceso main de Electron, embebiendo [pi-ai] | El CLI que ya tienes en disco (Claude Code / Codex / Cursor / Gemini / … 13 adapters) | **Tab del navegador (ToolLoopAgent del Vercel AI SDK, BYOK)** |
| Dónde viven el chat / los archivos | Nube (OmeletteService + blobs direccionados por contenido) | SQLite local + filesystem local | SQLite local + filesystem local | **Cloudflare D1 + R2 (tu cuenta)** |
| ¿Necesita CLI local / shell de escritorio? | No | Sí (instalador de Electron) | Sí (npm + uno de los 13 CLIs) | **No — abre la página en un navegador** |
| Fidelidad estructural al original | 100% | Media (agent en un runtime de escritorio, no en la web) | Media (agent en el CLI del usuario, lanzado por el daemon) | **Alta — agent en el navegador + backend como storage, misma forma que el original** |
| Licencia | Cerrado | MIT | Apache-2.0 | Apache-2.0 |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

En resumen: **open-codesign y nexu-io son local-first (agent en el escritorio o en el CLI del usuario, archivos en disco); nosotros y el Claude Design original somos web-first (agent en el navegador, archivos en un backend en la nube)**. Cada enfoque tiene sus trade-offs — elegimos el que está más alineado estructuralmente con lo que Anthropic realmente envía.

## Reconocimientos

Este proyecto está construido sobre el trabajo de mucha otra gente.

**[Claude Design de Anthropic](https://claude.ai/design)** es el producto que Open Claude Design recrea. Tenemos un enorme respeto por lo que construyó el equipo original y por la vara que pusieron — cada capa de la experiencia refleja cuánto se preocuparon. Este código es el proceso de estar a la altura de esa vara.

También queremos agradecer a otros dos proyectos open-source en este espacio:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — por la ingeniería open-source sólida y muy bien pensada que volcaron en esta dirección.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — por publicar abiertamente su propia toma del mismo problema.

Ambos enriquecieron la conversación open-source alrededor de este producto, y agradecemos que existan.

### Tooling

- [Vercel AI SDK](https://github.com/vercel/ai) — abstracción multi-provider que permite que el agent loop corra en un tab del navegador.
- [React](https://react.dev/) y [Babel](https://babeljs.io/) — los UMD builds que mueven el preview runtime dentro del iframe.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/) y [R2](https://developers.cloudflare.com/r2/) — el backend sin servidor que mantener.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/) y el resto del toolchain TypeScript / npm-workspaces.

## Aviso legal

Open Claude Design es un proyecto open-source recreado por la comunidad. **Este proyecto no está afiliado, respaldado ni patrocinado por Anthropic.** "Claude" y "Claude Design" son marcas registradas de Anthropic, PBC.

Parte de la guía de comportamiento del agent — específicamente el contenido del system prompt bajo [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — está adaptada de observaciones del runtime público de Claude Design de Anthropic. Conservamos este contenido bajo justificación de fair use / interoperabilidad, para mantener la recreación open-source fiel a la superficie original.

**Si alguien de Anthropic desea que retiremos o reescribamos algún contenido, lo haremos de inmediato** — por favor abre un issue en [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) o contacta al maintainer del repo.

## Qué hace

- **Chat → genera** un prototipo React multi-archivo, streameado token por token al workspace del proyecto.
- **Tweaks**: los design tokens definidos en el artifact se vuelven sliders / color pickers en vivo — los ajustas en el momento, sin re-prompt.
- **Comment**: pinea anotaciones en coordenadas del preview; manda el contexto pineado de vuelta al agent para reescrituras dirigidas.
- **Edit**: click en cualquier elemento, edita estilos inline o clases de Tailwind en un inspector flotante, persiste de vuelta a los archivos fuente.
- **Draw**: dibuja a mano sobre el preview; los trazos y una captura van al siguiente turno para que el modelo actúe sobre tu indicación visual.
- **Proyectos multi-archivo** (`.jsx` / `.html` / `.css`) renderizados a través de Babel Standalone en un iframe en sandbox — la resolución del entry prefiere `.html`, después `.jsx`/`.tsx`.
- **Importable** — arrastra un ZIP exportado de Claude Design al workspace y sigue editando desde donde lo dejó Anthropic.

## Stack

- **Frontend** — Vite + React 18.3.1 + React Router v6 + styled-components
- **Backend** — [Hono](https://hono.dev/) sobre Cloudflare Workers
- **Storage** — Cloudflare D1 (metadata) + R2 (blobs direccionados por sha256)
- **AI** — `ToolLoopAgent` del [Vercel AI SDK](https://github.com/vercel/ai) corriendo en el navegador, llamando a OpenRouter o a cualquiera de los 10 providers de primera mano directamente con la key del usuario
- **Wire** — HTTP REST + SSE, schemas fijados en [`packages/contracts`](packages/contracts/)
- **Tests** — Vitest (unit + integration) y Playwright (e2e)

## Desarrollo local

**Prerequisitos**: Node 22+, npm 10+. No hace falta cuenta de Cloudflare — `wrangler` corre D1 en modo `--local` contra un archivo SQLite bajo `.wrangler/state/`.

Pega este bloque entero en una terminal nueva:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # ~1 min la primera vez: instala deps + aplica migrations de D1
npm run dev      # web en :5173, api en :8787 (Ctrl-C para parar)
```

Cuando el dev server esté arriba, abre <http://localhost:5173>. El primer mensaje de chat te va a pedir una API key de OpenRouter — consigue una en [openrouter.ai/keys](https://openrouter.ai/keys) y pégala. La key vive solo en el `localStorage` de tu navegador; la borras o cambias cuando quieras en `/settings`.

Para las próximas sesiones, basta con `npm run dev` — `setup` es de una sola vez.

> Sanity check: `curl http://localhost:8787/health` → `200 {"ok":true,...}`.

## Self-host en Cloudflare

> Tú aportas una cuenta de Cloudflare; tus usuarios aportan su propia LLM key.

```bash
npm run cf:provision    # de una sola vez: wrangler login + crea D1 / R2 / aplica schema
npm run deploy          # cada vez: ship Worker (API) + Pages (SPA)
```

Cuando termine `npm run deploy` vas a tener `https://open-design-web.pages.dev` (SPA) y `https://open-design-api.<your-subdomain>.workers.dev` (API).

Lo que hace `cf:provision`, de un tirón: te loguea en Cloudflare (lo saltea si ya estás), crea la base D1 `open-design` y escribe su `database_id` de vuelta a [`apps/api/wrangler.toml`](apps/api/wrangler.toml), crea el bucket R2 `open-design-blobs` y aplica el schema de D1.

Lo que hace `deploy`: deploya el Worker, vendora los UMD bundles de React + Babel a `apps/web/public/vendor/` para que los previews funcionen offline / detrás de firewalls / bajo CSP estricta, buildea la SPA y la sube a Cloudflare Pages (proyecto `open-design-web`).

O sáltate el deploy manual y usa el GitHub Action que viene incluido — un push a `main` dispara `.github/workflows/deploy.yml` una vez que agregues `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` a los secrets del repo. El workflow no hace nada sin esos, así que un fork limpio es seguro.

## Layout del repo

```
open-claude-design/
├── apps/
│   ├── web/                — Frontend (Vite + React + styled-components)
│   │   └── src/features/
│   │       ├── chat/       — ToolLoopAgent del lado del navegador + tools + system prompts
│   │       ├── preview/    — Iframe + overlays de Tweaks/Comment/Edit/Draw
│   │       ├── workspace/  — Workspace de archivos multi-tab + estado del proyecto
│   │       ├── home/       — Landing, selector de proyectos, galería de ejemplos
│   │       └── settings/   — Gestión de la BYOK key
│   └── api/                — Backend (Hono sobre Cloudflare Workers + D1 + R2)
├── packages/
│   ├── contracts/          — Wire contracts TypeScript compartidos (fuente única de verdad)
│   ├── design-tokens/      — Tokens de color/tipografía (TS + CSS, doble fuente)
│   └── iframe-runtime/     — Overlay dentro del iframe + bridge de Tweaks (cero deps de runtime, puro armado de strings)
└── e2e/                    — Suite end-to-end de Playwright
```

## Contribuir

Los PRs son bienvenidos. El proyecto está pre-alpha y la vara para contribuir es baja.

```bash
npm install
npm run typecheck   # tsc --noEmit en todo el workspace
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright (requiere `npm run dev` corriendo)
```

Mirá [CONTRIBUTING.md](CONTRIBUTING.md) para branching, convenciones de commits y un recorrido guiado de lectura por el código.

## License

[Apache License 2.0](LICENSE) — fork, modificá, ship.
