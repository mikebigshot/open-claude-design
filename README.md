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

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">By <a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **Status: pre-alpha.** The architecture is settled and the four preview tools work end-to-end, but breaking changes can still land in any release. Pin a commit if you depend on the wire format.

## Why this exists

Anthropic's [Claude Design](https://claude.ai/design) turned an LLM into a tool that ships interactive design artifacts: chat in, multi-file React prototype out, edit any element inline, ship. It went viral and stayed closed-source, paid-only, cloud-only, locked to Anthropic's stack.

**Open Claude Design is a faithful open-source recreation of that surface, with the same technical bones.** Where we had a choice, we deferred to what Anthropic actually shipped — the artifact format, the `EDITMODE` Tweaks block, the `<uuid>::verifier` sub-agent convention, the in-iframe Babel-Standalone preview path, the four-tool `postMessage` grammar (`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …). The single biggest input to this codebase is reading what Anthropic published.

**Like Claude Design, the agent loop stays in the browser tab and chat / files / project state sync to your own backend.** This is the most important point of structural alignment with the original — Anthropic's cloud is just an LLM passthrough + tool execution + project-snapshot store, and the agent loop itself runs in the browser SPA. We do the same: [Vercel AI SDK](https://github.com/vercel/ai)'s tool loop runs in your tab, while chat / files / project state flow through a Cloudflare Worker into D1 + R2, and the Worker never sees your prompts. This **web-agent + backend-storage** shape is also exactly the shape that scales into a SaaS.

## Architecture

> This section is the implicit spec for the codebase. The findings come from a logged-in investigation of `claude.ai/design` during 2026-04 — DOM inspection, network capture, global-variable reads, downloaded artifacts, deobfuscated runtime, and a working POC. We try to stick to directly observed facts.

### What Claude Design looks like

The browser hosts the agent; the cloud is just an LLM gateway + tool backend. A single turn's Chat request body is a direct Anthropic Messages API passthrough (full system + tools + all messages, assembled client-side). The cloud `OmeletteService` **does not maintain conversation state** — it just relays to the LLM, executes tools, and stores project snapshots.

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

#### Key observations

| Dimension | What's actually shipping |
|---|---|
| Main-app frontend | Vite + React Router v6 + styled-components; the code editor is a native `<textarea>` plus hand-rolled `<div>` line numbers — no Monaco, no CodeMirror |
| Backend protocol | Connect / gRPC-Web + Protobuf; service name `anthropic.omelette.api.v1alpha.OmeletteService` |
| Agent tool protocol | MCP (Model Context Protocol) — captured a complete `tools/list` payload with the `defer_loading` field; third-party MCP servers really do plug in |
| Tool routing | 30+ tools dispatched across 9 buckets: cloud RPC (EditFile / GetFile / …) / local FSA (local_*) / iframe DOM (show_html / eval_js / screenshot) / pure client logic (snip / update_todos) / spawned sub-agent / third-party MCP / LLM-built-in (web_search / web_fetch) |
| Verifier sub-agent | Shares the main agent's **system prompt + toolset + history**; the entire fork is just a role-reset prompt stuffed into the fork tool_result + a `::verifier` suffix on the sessionUUID + max_tokens halved |
| Preview iframe | Each project on its own subdomain `{project-uuid}.claudeusercontent.com`; the main site sets CSP `default-src 'none'; frame-ancestors 'none'`; preview tokens are 4 segments: `{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}` |
| Generated-artifact runtime | React **18.3.1** + Babel Standalone **7.29.0** (UMD, integrity-hash pinned) + inline `style={{...}}` JS objects + Google Fonts + multi-JSX `<script type="text/babel" src="*.jsx">` mounted on the global window |
| Tweaks protocol | Artifacts embed `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` blocks + `EDIT_STYLE` postMessage to write back live, without re-running the model |
| Client-authoritative storage | The browser holds the full chats / messages / contentBlocks / tool I/O / viewState / assets manifest, and pushes a complete snapshot back via `UpdateProjectData`. **Every tool call's input/output is persisted** |
| `done` compound op | Triggers a chain of EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData |
| Streaming | Not native Anthropic SSE — OmeletteService re-wraps it as custom frames: `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` |
| Local-folder bridge | File System Access API + 4 `local_*` tools (local_ls / local_read / local_grep / local_copy_to_project); local files **never** reach OmeletteService — they only appear in the LLM context |

### What Open Claude Design looks like

We carry that diagram over verbatim: agent loop in the browser, cloud is storage-only. The overall shape aligns with the original; we simplify only on engineering trade-offs (HTTP REST instead of Connect / gRPC-Web, a Cloudflare Worker instead of a custom backend, BYOK instead of hosted keys).

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

#### What we keep from the original

- **Browser-side agent loop** — Vercel AI SDK's `ToolLoopAgent` runs in the tab (the original's agent framework isn't public, but the host is the same)
- **Client-authoritative + backend snapshot** — D1 holds project metadata, R2 holds sha256 content-addressed blobs, written as full snapshots
- **Preview iframe runtime** — React 18.3.1 + Babel Standalone 7.29.0, same versions and integrity hashes, multi-JSX entry semantics preserved
- **Protocol literals** — Tweaks `EDITMODE-BEGIN/END`, postMessage types like `SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY`, the `<uuid>::verifier` sub-agent naming convention — all kept verbatim

#### Where we deliberately diverge

- **Wire protocol** — simplified from Connect / gRPC-Web to HTTP REST + SSE (schemas in [`packages/contracts`](packages/contracts/), no `.proto` reuse)
- **Fonts** — commercial Anthropic Serif swapped for Google Fonts (Inter / Instrument Serif / JetBrains Mono); icons via Lucide
- **Preview subdomain** — `*.claudeusercontent.com` swapped for the Cloudflare Pages default subdomain (bring your own domain on self-host)
- **Local-folder bridge / third-party MCP / verifier sub-agent** — not yet implemented (roadmap)

## Differences from nexu-io/open-design and OpenCoworkAI/open-codesign

All three projects are open-source recreations of Claude Design. The split is mostly about **where the agent loop runs and where chat / files end up**.

|  | Claude Design (original) | [open-codesign][ocod] | [nexu-io/open-design][nexu] | **Open Claude Design** |
|---|---|---|---|---|
| Form factor | Web (claude.ai) | Desktop (Electron) | Web app + local daemon | **Pure web + Cloudflare Workers** |
| Where the agent loop runs | Browser tab | Inside the Electron main process, bundling [pi-ai] | The CLI you already have on disk (Codex / Cursor / Gemini / … 13 adapters) | **Browser tab (Vercel AI SDK ToolLoopAgent, BYOK)** |
| Where chat / files live | Cloud (OmeletteService + content-addressed blobs) | Local SQLite + local filesystem | Local SQLite + local filesystem | **Cloudflare D1 + R2 (your account)** |
| Need a local CLI / desktop shell? | No | Yes (Electron installer) | Yes (npm + one of 13 CLIs) | **No — open the page in a browser** |
| Structural fidelity to the original | 100% | Medium (agent on a desktop runtime, not the web) | Medium (agent in the user's CLI, spawned by the daemon) | **High — agent in the browser + backend as storage, same shape as the original** |
| License | Closed | MIT | Apache-2.0 | Apache-2.0 |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

In short: **open-codesign and nexu-io are local-first (agent on the desktop or in the user's CLI, files on disk); we and the original Claude Design are web-first (agent in the browser, files in a cloud backend)**. Each has trade-offs — we picked the one most structurally aligned with what Anthropic actually ships.

## Acknowledgments

This project is built on top of a lot of other people's work.

**[Anthropic's Claude Design](https://claude.ai/design)** is the product Open Claude Design recreates. We have enormous respect for what the original team built and for the bar they set — every layer of the experience reflects how much they cared. This codebase is the process of measuring up to that bar.

We also want to thank two other open-source projects in this space:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — for the substantial, carefully thought-through open-source engineering they've poured into this direction.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — for openly publishing their own take on the same problem.

Both have made the open-source conversation around this product richer, and we're grateful they exist.

### Tooling

- [Vercel AI SDK](https://github.com/vercel/ai) — multi-provider abstraction that lets the agent loop run in a browser tab.
- [React](https://react.dev/) and [Babel](https://babeljs.io/) — UMD builds powering the in-iframe preview runtime.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/), and [R2](https://developers.cloudflare.com/r2/) — the no-server-to-run backend.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/), and the wider TypeScript / npm-workspaces toolchain.

## Disclaimer

Open Claude Design is a community open-source recreation. **It is not affiliated with, endorsed by, or sponsored by Anthropic.** "Claude" and "Claude Design" are trademarks of Anthropic, PBC.

Some of the agent's behavioral guidance — specifically the system-prompt content under [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — is adapted from observations of Anthropic's published Claude Design runtime. We retain this content under a fair-use / interoperability rationale to keep the open recreation faithful to the original surface.

**If anyone at Anthropic would like content removed or rewritten, we will do so promptly** — please open an issue at [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) or contact the maintainer.

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

> You bring a Cloudflare account; your users bring their own LLM key.

```bash
npm run cf:provision    # one-time: wrangler login + create D1 / R2 / apply schema
npm run deploy          # every time: ship Worker (API) + Pages (SPA)
```

After `npm run deploy` finishes you'll have `https://open-design-web.pages.dev` (SPA) and `https://open-design-api.<your-subdomain>.workers.dev` (API).

What `cf:provision` does, in one shot: signs you in to Cloudflare (skips if already), creates the `open-design` D1 database and writes its `database_id` back into [`apps/api/wrangler.toml`](apps/api/wrangler.toml), creates the `open-design-blobs` R2 bucket, applies the D1 schema.

What `deploy` does: deploys the Worker, vendors React + Babel UMD bundles into `apps/web/public/vendor/` so previews work offline / behind firewalls / under strict CSP, builds the SPA, ships to Cloudflare Pages (project `open-design-web`).

Or skip the manual deploy and use the bundled GitHub Action — push to `main` triggers `.github/workflows/deploy.yml` once you add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to repo secrets. The workflow no-ops without them, so a vanilla fork is safe.

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

PRs are welcome. The project is pre-alpha and the bar for contribution is loose.

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
