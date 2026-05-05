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

Divergimos de Claude Design en una dirección: **puro web, sin shell, sin SaaS.** Todo corre en un tab del navegador más un Cloudflare Worker. El chat agent (el tool-loop del [Vercel AI SDK](https://github.com/vercel/ai)) se ejecuta _en tu tab_ y habla con OpenRouter directamente con tu key — el Worker es solo storage y nunca ve tus prompts. Esa decisión te trae tres cosas:

1. **Deploy con un bloque de comandos en una cuenta gratuita de Cloudflare** — sin Postgres, sin Redis, sin ECS, sin Docker.
2. **Sin cuentas, sin SaaS compartido, sin cuotas** — fork, deploy, y le pasas el link a tus amigos.
3. **Un código que se puede leer entero** — TS estricto, npm workspaces, ~10 carpetas de fuentes. Las partes interesantes (iframe runtime, el protocolo `EDITMODE`, el agent loop del lado del navegador) se leen en un fin de semana.

## Reconocimientos

Este proyecto está construido sobre el trabajo de mucha otra gente.

**[Claude Design de Anthropic](https://claude.ai/design)** es el producto que Open Claude Design recrea. Tenemos un enorme respeto por lo que construyó el equipo original y por la vara que pusieron — cada capa de la experiencia refleja cuánto se preocuparon. Este código es el proceso de estar a la altura de esa vara.

También queremos agradecer a otros dos proyectos open-source en este espacio:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — por la ingeniería open-source sólida y muy bien pensada que volcaron en esta dirección.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — por publicar abiertamente su propia toma del mismo problema.

Ambos enriquecieron la conversación open-source alrededor de este producto, y agradecemos que existan.

### Tooling

- [Vercel AI SDK](https://github.com/vercel/ai) — abstracción multi-provider que permite que el agent loop corra en un tab del navegador.
- [OpenRouter](https://openrouter.ai/) — una BYOK key delante de docenas de providers de LLM.
- [React](https://react.dev/) y [Babel](https://babeljs.io/) — los UMD builds que mueven el preview runtime dentro del iframe.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/) y [R2](https://developers.cloudflare.com/r2/) — el backend sin servidor que mantener.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/) y el resto del toolchain TypeScript / npm-workspaces.

## Aviso legal

Open Claude Design es un proyecto open-source recreado por la comunidad. **Este proyecto no está afiliado, respaldado ni patrocinado por Anthropic.** "Claude" y "Claude Design" son marcas registradas de Anthropic, PBC.

Parte de la guía de comportamiento del agent — específicamente el contenido del system prompt bajo [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — está adaptada de observaciones del runtime público de Claude Design de Anthropic. Conservamos este contenido bajo justificación de fair use / interoperabilidad, para mantener la recreación open-source fiel a la superficie original.

**Si alguien de Anthropic desea que retiremos o reescribamos algún contenido, lo haremos de inmediato** — por favor abre un issue en [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) o contacta al maintainer del repo.

## De un vistazo

| | Lo que recibes |
|---|---|
| **Forma** | Puro web — Vite SPA + un Cloudflare Worker. Sin Electron, sin daemon local, sin instalación nativa. |
| **AI runtime** | El `ToolLoopAgent` del Vercel AI SDK corre **en el tab del navegador**. Las tools (`edit_file` / `read_file` / `list_files` / `mark_done`) llaman a la REST API del Worker para persistir archivos; el Worker nunca ve prompts ni keys. |
| **Providers** | OpenRouter es el fan-out por defecto (una key → Anthropic, OpenAI, Google, Mistral, xAI, DeepSeek, Groq, Cerebras, …). También están cableados los SDKs directos de cada provider: `@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}` más cualquier endpoint compatible con OpenAI. Las keys viven en `localStorage`. |
| **Storage** | Cloudflare **D1** (SQLite) para metadata + **R2** para blobs de archivo direccionados por contenido sha256. Un único Worker bindea ambos. La free tier alcanza de sobra para proyectos personales. |
| **Superficie de preview** | Un iframe en sandbox que renderiza React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 — armado a partir de un `srcdoc` que es puro string. Cero filtraciones de runtime de React/npm dentro del preview. Para deploys offline o con CSP estricta puedes vendor los UMD bundles. |
| **Tweaks** | Los artifacts emiten un bloque `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` que declara design tokens ajustables. La UI host muestra sliders / pickers; los cambios vuelven como eventos `postMessage` `EDIT_STYLE` sin volver a correr el modelo. |
| **Comment** | Pinea anotaciones en cualquier punto del preview en vivo, escribe un comentario, y manda ese contexto pineado al agent para una reescritura dirigida. |
| **Edit** | Click sobre cualquier elemento del DOM — el inspector flota, ajustas estilos inline o clases de Tailwind, y el cambio queda persistido en los archivos del proyecto. |
| **Draw** | Dibuja a mano alzada sobre el preview con una pen tool; los trazos más una captura de pantalla viajan al modelo para que reescriba a partir de tu dibujo. |
| **Wire** | HTTP REST + Server-Sent Events. La fuente única de verdad está en [`packages/contracts`](packages/contracts/) — cada tipo de evento SSE, cada tipo de postMessage y cada shape de ruta está ahí como literal. |
| **License** | Apache-2.0 |

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

> Tú aportas una cuenta de Cloudflare; tus usuarios aportan su propia LLM key. Nosotros no corremos un SaaS hosteado.

```bash
npm run cf:provision    # de una sola vez: wrangler login + crea D1 / R2 / aplica schema
npm run deploy          # cada vez: ship Worker (API) + Pages (SPA)
```

Cuando termine `npm run deploy` vas a tener `https://open-design-web.pages.dev` (SPA) y `https://open-design-api.<your-subdomain>.workers.dev` (API).

Lo que hace `cf:provision`, de un tirón: te loguea en Cloudflare (lo saltea si ya estás), crea la base D1 `open-design` y escribe su `database_id` de vuelta a [`apps/api/wrangler.toml`](apps/api/wrangler.toml), crea el bucket R2 `open-design-blobs` y aplica el schema de D1.

Lo que hace `deploy`: deploya el Worker, vendora los UMD bundles de React + Babel a `apps/web/public/vendor/` para que los previews funcionen offline / detrás de firewalls / bajo CSP estricta, buildea la SPA y la sube a Cloudflare Pages (proyecto `open-design-web`).

O sáltate el deploy manual y usa el GitHub Action que viene incluido — un push a `main` dispara `.github/workflows/deploy.yml` una vez que agregues `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` a los secrets del repo. El workflow no hace nada sin esos, así que un fork limpio es seguro.

### Dominio personalizado

En el dashboard de Cloudflare, conecta un dominio personalizado al proyecto Pages (por ejemplo `design.example.com`) y otro al Worker (por ejemplo `api.design.example.com`). La SPA espera que `/api/*` llegue al Worker — configura una Pages Function route o un rewrite en la UI de Cloudflare Routes para ese path.

Agrega el origin de la SPA al `ALLOWED_ORIGINS` `[vars]` del Worker en [`apps/api/wrangler.toml`](apps/api/wrangler.toml) (separados por comas) y vuelve a deployar el Worker — si no, CORS va a bloquear los requests.

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

Los PRs son bienvenidos. El proyecto está pre-alpha y la vara para contribuir es baja — corrige un typo, abre un bug, esboza una feature.

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
