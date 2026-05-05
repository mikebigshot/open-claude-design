# Open Claude Design

> **An open-source recreation of [Claude Design](https://claude.ai/design) as a pure web app.** Chat-driven multi-file React prototyping with four in-place preview tools — **Tweaks · Comment · Edit · Draw**. The agent runs in your browser tab; a single Cloudflare Worker (D1 + R2) holds the files. No Electron, no local daemon, no server-side LLM proxy.

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
  <a href="#local-development"><img alt="Local dev" src="https://img.shields.io/badge/local%20dev-1%20command-green?style=flat-square" /></a>
  <a href="#self-host-on-cloudflare"><img alt="Self-host" src="https://img.shields.io/badge/self--host-1%20command-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">By <a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **Status: pre-alpha.** The architecture is settled and the four preview tools work end-to-end, but breaking changes can still land in any release. Pin a commit if you depend on the wire format.

## Why this exists

Anthropic's [Claude Design](https://claude.ai/design) turned an LLM into a tool that ships interactive design artifacts: chat in, multi-file React prototype out, edit any element inline, ship. It went viral and stayed closed-source, paid-only, cloud-only, locked to Anthropic's stack.

**Open Claude Design is a faithful open-source recreation of that surface, with the same technical bones.** Where we had a choice, we deferred to what Anthropic actually shipped — the artifact format, the `EDITMODE` Tweaks block, the `<uuid>::verifier` sub-agent convention, the in-iframe Babel-Standalone preview path, the four-tool `postMessage` grammar (`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …). The single biggest input to this codebase is reading what Anthropic published.

We diverge from Claude Design in one direction: **pure web, no shell, no SaaS.** Everything runs in a browser tab plus one Cloudflare Worker. The chat agent ([Vercel AI SDK](https://github.com/vercel/ai)'s tool-loop) executes _in your tab_ and talks to OpenRouter directly with your key — the Worker is storage-only and never sees your prompts. That trade-off buys three things:

1. **One-command deploy on a free Cloudflare account** — no Postgres, no Redis, no ECS, no Docker.
2. **No accounts, no shared SaaS, no quota** — fork it, deploy it, give your friends the link.
3. **A readable codebase** — strict TS, npm workspaces, ~10 source folders. The interesting parts (iframe runtime, `EDITMODE` protocol, browser-side agent loop) fit in a weekend's reading.

## Acknowledgments

This project is built on top of a lot of other people's work.

**[Anthropic's Claude Design](https://claude.ai/design)** is the product Open Claude Design recreates. We have enormous respect for what the original team built and for the bar they set — every layer of the experience reflects how much they cared. This codebase is the process of measuring up to that bar.

We also want to thank two other open-source projects in this space:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — for the substantial, carefully thought-through open-source engineering they've poured into this direction.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — for openly publishing their own take on the same problem.

Both have made the open-source conversation around this product richer, and we're grateful they exist.

### Tooling

- [Vercel AI SDK](https://github.com/vercel/ai) — multi-provider abstraction that lets the agent loop run in a browser tab.
- [OpenRouter](https://openrouter.ai/) — one BYOK key in front of dozens of LLM providers.
- [React](https://react.dev/) and [Babel](https://babeljs.io/) — UMD builds powering the in-iframe preview runtime.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/), and [R2](https://developers.cloudflare.com/r2/) — the no-server-to-run backend.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/), and the wider TypeScript / npm-workspaces toolchain.

## Disclaimer

Open Claude Design is a community open-source recreation. **It is not affiliated with, endorsed by, or sponsored by Anthropic.** "Claude" and "Claude Design" are trademarks of Anthropic, PBC.

Some of the agent's behavioral guidance — specifically the system-prompt content under [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — is adapted from observations of Anthropic's published Claude Design runtime. We retain this content under a fair-use / interoperability rationale to keep the open recreation faithful to the original surface.

**If anyone at Anthropic would like content removed or rewritten, we will do so promptly** — please open an issue at [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) or contact the maintainer.

## At a glance

| | What you get |
|---|---|
| **Form factor** | Pure web — Vite SPA + one Cloudflare Worker. No Electron, no local daemon, no native install. |
| **AI runtime** | Vercel AI SDK's `ToolLoopAgent` runs **in the browser tab**. Tools (`edit_file` / `read_file` / `list_files` / `mark_done`) call the Worker's REST API to persist files; the Worker never sees prompts or keys. |
| **Providers** | OpenRouter is the default fan-out (one key → Anthropic, OpenAI, Google, Mistral, xAI, DeepSeek, Groq, Cerebras, …). Direct provider SDKs are also wired: `@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}` plus any OpenAI-compatible endpoint. Keys live in `localStorage`. |
| **Storage** | Cloudflare **D1** (SQLite) for metadata + **R2** for sha256 content-addressed file blobs. One Worker binds both. Free tier holds plenty for solo projects. |
| **Preview surface** | A sandboxed iframe rendering React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 — assembled from a pure-string `srcdoc`. Zero React/npm runtime leaks into the preview. UMD bundles can be vendored for offline / strict-CSP deploys. |
| **Tweaks** | Artifacts emit a `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` block declaring tunable design tokens. The host UI surfaces sliders / pickers; changes flow back as `EDIT_STYLE` `postMessage` events without re-running the model. |
| **Comment** | Drop pins anywhere on the live preview, write a comment, send the pinned context to the agent for a targeted rewrite. |
| **Edit** | Click any DOM element — the inspector floats, you tweak inline styles or Tailwind classes, the change persists back into the project files. |
| **Draw** | Sketch over the preview with a pen tool; strokes plus a screenshot get sent to the model so it can rewrite from your hand-drawn cue. |
| **Wire** | HTTP REST + Server-Sent Events. Single source of truth in [`packages/contracts`](packages/contracts/) — every SSE event type, postMessage type, and route shape is a literal there. |
| **License** | Apache-2.0 |

## What it does

- **Chat → generate** a multi-file React prototype, streamed token-by-token into the project workspace.
- **Tweaks**: artifact-defined design tokens become live sliders / color pickers — adjust in-place, no re-prompt.
- **Comment**: pin annotations to coordinates on the preview; send pinned context back to the agent for targeted rewrites.
- **Edit**: click any element, edit inline styles or Tailwind classes in a floating inspector, persist back into source files.
- **Draw**: hand-sketch over the preview; strokes and a screenshot ride into the next turn so the model can act on your cue.
- **Multi-file projects** (`.jsx` / `.html` / `.css`) rendered through Babel Standalone in a sandboxed iframe — entry resolution prefers `.html`, then `.jsx`/`.tsx`.
- **Importable** — drop a Claude-Design ZIP export onto the workspace and keep editing from where Anthropic left off.

## Stack

- **Frontend** — Vite + React 18.3.1 + React Router v6 + styled-components
- **Backend** — [Hono](https://hono.dev/) on Cloudflare Workers
- **Storage** — Cloudflare D1 (metadata) + R2 (sha256-addressed blobs)
- **AI** — [Vercel AI SDK](https://github.com/vercel/ai) `ToolLoopAgent` running in the browser, calling OpenRouter or any of 10 first-party providers directly with the user's key
- **Wire** — HTTP REST + SSE, schemas locked in [`packages/contracts`](packages/contracts/)
- **Tests** — Vitest (unit + integration) and Playwright (e2e)

## Local development

**Prerequisites**: Node 22+, npm 10+. No Cloudflare account needed — `wrangler` runs D1 in `--local` mode against a SQLite file under `.wrangler/state/`.

Copy-paste this whole block into a fresh terminal:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # ~1 min on first run: installs deps + applies D1 migrations
npm run dev      # web on :5173, api on :8787 (Ctrl-C to stop)
```

When the dev server is up, open <http://localhost:5173>. The first chat message will prompt for an OpenRouter API key — grab one at [openrouter.ai/keys](https://openrouter.ai/keys) and paste it. The key lives only in your browser's `localStorage`; clear or change it any time at `/settings`.

For the next sessions, just `npm run dev` — `setup` is one-time.

> Sanity check: `curl http://localhost:8787/health` → `200 {"ok":true,...}`.

## Self-host on Cloudflare

> You bring a Cloudflare account; your users bring their own LLM key. We do not run a hosted SaaS.

```bash
npm run cf:provision    # one-time: wrangler login + create D1 / R2 / apply schema
npm run deploy          # every time: ship Worker (API) + Pages (SPA)
```

After `npm run deploy` finishes you'll have `https://open-design-web.pages.dev` (SPA) and `https://open-design-api.<your-subdomain>.workers.dev` (API).

What `cf:provision` does, in one shot: signs you in to Cloudflare (skips if already), creates the `open-design` D1 database and writes its `database_id` back into [`apps/api/wrangler.toml`](apps/api/wrangler.toml), creates the `open-design-blobs` R2 bucket, applies the D1 schema.

What `deploy` does: deploys the Worker, vendors React + Babel UMD bundles into `apps/web/public/vendor/` so previews work offline / behind firewalls / under strict CSP, builds the SPA, ships to Cloudflare Pages (project `open-design-web`).

Or skip the manual deploy and use the bundled GitHub Action — push to `main` triggers `.github/workflows/deploy.yml` once you add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to repo secrets. The workflow no-ops without them, so a vanilla fork is safe.

### Custom domain

In the Cloudflare dashboard, attach a custom domain to the Pages project (e.g. `design.example.com`) and to the Worker (e.g. `api.design.example.com`). The SPA expects `/api/*` to reach the Worker — set up a Pages Function route or a Cloudflare Routes UI rewrite for that path.

Add the SPA's origin to the Worker's `ALLOWED_ORIGINS` `[vars]` in [`apps/api/wrangler.toml`](apps/api/wrangler.toml) (comma-separated), then redeploy the Worker — otherwise CORS will block requests.

## Repository layout

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
│   └── api/                — Backend (Hono on Cloudflare Workers + D1 + R2)
├── packages/
│   ├── contracts/          — Shared TypeScript wire contracts (single source of truth)
│   ├── design-tokens/      — Color/typography tokens (TS + CSS dual-source)
│   └── iframe-runtime/     — In-iframe overlay + Tweaks bridge (zero runtime deps, pure string assembly)
└── e2e/                    — Playwright end-to-end suite
```

## Contributing

PRs are welcome. The project is pre-alpha and the bar for contribution is loose — fix a typo, file a bug, sketch a feature.

```bash
npm install
npm run typecheck   # tsc --noEmit across the workspace
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright (requires `npm run dev` running)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branching, commit conventions, and a guided reading path through the codebase.

## License

[Apache License 2.0](LICENSE) — fork, modify, ship.
