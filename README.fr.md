# Open Claude Design

> **Une recréation open-source de [Claude Design](https://claude.ai/design) sous forme de pure web app.** Prototypage React multi-fichiers piloté par chat, avec quatre outils de prévisualisation in situ — **Tweaks · Comment · Edit · Draw**. L'agent tourne dans votre tab navigateur ; un seul Cloudflare Worker (D1 + R2) stocke les fichiers. Pas d'Electron, pas de daemon local, pas de proxy LLM côté serveur.

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Statut" src="https://img.shields.io/badge/statut-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/stack-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#développement-local"><img alt="Dev local" src="https://img.shields.io/badge/dev%20local-1%20commande-green?style=flat-square" /></a>
  <a href="#auto-hébergement-sur-cloudflare"><img alt="Auto-hébergement" src="https://img.shields.io/badge/auto--hébergement-1%20commande-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es-ES.md">Español</a> · <b>Français</b> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">Par <a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **Statut : pre-alpha.** L'architecture est stabilisée et les quatre outils de prévisualisation fonctionnent de bout en bout, mais des breaking changes peuvent encore tomber dans n'importe quelle release. Épinglez un commit si vous dépendez du wire format.

## Pourquoi ce projet existe

[Claude Design](https://claude.ai/design) d'Anthropic a transformé un LLM en un outil qui livre des artifacts de design interactifs : chat en entrée, prototype React multi-fichiers en sortie, édition de n'importe quel élément en place, ship. C'est devenu viral et c'est resté closed-source, payant, cloud-only, verrouillé sur la stack d'Anthropic.

**Open Claude Design est une recréation open-source fidèle de cette surface, avec la même ossature technique.** Quand un choix s'imposait, on s'est appuyé sur ce qu'Anthropic a réellement publié — le format d'artifact, le bloc Tweaks `EDITMODE`, la convention de sub-agent `<uuid>::verifier`, le pipeline de prévisualisation in-iframe via Babel-Standalone, la grammaire `postMessage` des quatre outils (`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …). La plus grosse source d'inspiration de ce code, c'est de lire ce qu'Anthropic a publié.

**Comme Claude Design, l'agent loop reste dans le tab navigateur et le chat / les fichiers / l'état du projet sont synchronisés vers votre propre backend.** C'est le point d'alignement structurel le plus important avec l'original — le cloud d'Anthropic n'est qu'un passthrough LLM + exécution de tools + stockage de snapshots de projet, et l'agent loop tourne dans le SPA navigateur. On fait pareil : la tool loop du [Vercel AI SDK](https://github.com/vercel/ai) tourne dans votre tab, tandis que le chat / les fichiers / l'état du projet transitent par un Cloudflare Worker vers D1 + R2, et le Worker ne voit jamais vos prompts. Cette forme **agent-web + stockage-backend** est aussi exactement la forme qui scale en SaaS.

## Architecture

> Cette section est la spec implicite du codebase. Les constats viennent d'une investigation logged-in de `claude.ai/design` durant 2026-04 — inspection DOM, capture réseau, lecture des variables globales, artifacts téléchargés, runtime déobfusqué, et un POC fonctionnel. On essaie de s'en tenir aux faits directement observés.

### À quoi ressemble Claude Design

Même forme que Claude Code : le navigateur héberge l'agent, le cloud n'est qu'un gateway LLM + backend de tools. Le body d'une requête Chat sur un seul tour est un passthrough direct de l'API Anthropic Messages (full system + tools + tous les messages, assemblés côté client). Le `OmeletteService` cloud **ne maintient pas l'état conversationnel** — il relaie au LLM, exécute les tools, et stocke les snapshots de projet.

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

#### Observations clés

| Dimension | Ce qui est réellement shipé |
|---|---|
| Frontend de l'app principale | Vite + React Router v6 + styled-components ; l'éditeur de code est un `<textarea>` natif plus des numéros de ligne `<div>` à la main — pas de Monaco, pas de CodeMirror |
| Protocole backend | Connect / gRPC-Web + Protobuf ; nom de service `anthropic.omelette.api.v1alpha.OmeletteService` |
| Protocole de tools agent | MCP (Model Context Protocol) — payload complet `tools/list` capturé avec le champ `defer_loading` ; les MCP servers tiers se branchent vraiment |
| Routing des tools | 30+ tools dispatchés sur 9 buckets : RPC cloud (EditFile / GetFile / …) / FSA local (local_*) / DOM iframe (show_html / eval_js / screenshot) / logique client pure (snip / update_todos) / sub-agent spawné / MCP tiers / built-in LLM (web_search / web_fetch) |
| Sub-agent verifier | Partage le **system prompt + toolset + history** de l'agent principal ; le fork entier n'est qu'un prompt de role-reset enfoncé dans le tool_result du fork + un suffixe `::verifier` sur le sessionUUID + max_tokens divisé par deux |
| Iframe de prévisualisation | Chaque projet sur son propre sous-domaine `{project-uuid}.claudeusercontent.com` ; le site principal pose CSP `default-src 'none'; frame-ancestors 'none'` ; les preview tokens font 4 segments : `{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}` |
| Runtime des artifacts générés | React **18.3.1** + Babel Standalone **7.29.0** (UMD, integrity-hash épinglé) + objets JS `style={{...}}` inline + Google Fonts + multi-JSX `<script type="text/babel" src="*.jsx">` montés sur le window global |
| Protocole Tweaks | Les artifacts intègrent des blocs `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` + postMessage `EDIT_STYLE` pour writeback live, sans relancer le modèle |
| Storage client-authoritative | Le navigateur tient le full chats / messages / contentBlocks / I/O des tools / viewState / manifest d'assets, et pousse un snapshot complet via `UpdateProjectData`. **L'input/output de chaque tool call est persisté** |
| Op composée `done` | Déclenche une chaîne EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData |
| Streaming | Pas le SSE Anthropic natif — OmeletteService re-wrappe en frames custom : `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` |
| Bridge local-folder | File System Access API + 4 tools `local_*` (local_ls / local_read / local_grep / local_copy_to_project) ; les fichiers locaux **n'atteignent jamais** OmeletteService — ils n'apparaissent que dans le contexte LLM |

### À quoi ressemble Open Claude Design

On reprend ce diagramme verbatim : agent loop dans le navigateur, cloud purement storage. La forme globale s'aligne sur l'original ; on simplifie uniquement sur des trade-offs d'ingénierie (HTTP REST au lieu de Connect / gRPC-Web, un Cloudflare Worker au lieu d'un backend custom, BYOK au lieu de keys hébergées).

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

#### Ce qu'on garde de l'original

- **Agent loop côté navigateur** — le `ToolLoopAgent` du Vercel AI SDK tourne dans le tab (le framework d'agent de l'original n'est pas public, mais l'host est le même)
- **Client-authoritative + snapshot backend** — D1 tient les métadonnées de projet, R2 tient des blobs sha256 content-addressed, écrits en snapshots complets
- **Runtime de l'iframe de prévisualisation** — React 18.3.1 + Babel Standalone 7.29.0, mêmes versions et integrity hashes, sémantique d'entry multi-JSX préservée
- **Littéraux de protocole** — Tweaks `EDITMODE-BEGIN/END`, types postMessage comme `SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY`, convention de nommage de sub-agent `<uuid>::verifier` — tous gardés verbatim

#### Là où on diverge délibérément

- **Wire protocol** — simplifié de Connect / gRPC-Web vers HTTP REST + SSE (schemas dans [`packages/contracts`](packages/contracts/), pas de réutilisation `.proto`)
- **Polices** — Anthropic Serif commercial remplacé par Google Fonts (Inter / Instrument Serif / JetBrains Mono) ; icônes via Lucide
- **Sous-domaine de prévisualisation** — `*.claudeusercontent.com` remplacé par le sous-domaine par défaut Cloudflare Pages (apportez votre propre domaine en self-host)
- **Bridge local-folder / MCP tiers / sub-agent verifier** — pas encore implémentés (roadmap)

## Différences avec nexu-io/open-design et OpenCoworkAI/open-codesign

Les trois projets sont des recréations open-source de Claude Design. Le partage tient principalement à **où tourne l'agent loop et où finissent le chat / les fichiers**.

|  | Claude Design (original) | [open-codesign][ocod] | [nexu-io/open-design][nexu] | **Open Claude Design** |
|---|---|---|---|---|
| Form factor | Web (claude.ai) | Desktop (Electron) | App web + daemon local | **Pure web + Cloudflare Workers** |
| Où tourne l'agent loop | Tab navigateur | Dans le main process Electron, en bundlant [pi-ai] | Le CLI déjà installé sur disque (Claude Code / Codex / Cursor / Gemini / … 13 adapters) | **Tab navigateur (ToolLoopAgent Vercel AI SDK, BYOK)** |
| Où vivent chat / fichiers | Cloud (OmeletteService + blobs content-addressed) | SQLite local + filesystem local | SQLite local + filesystem local | **Cloudflare D1 + R2 (votre compte)** |
| Besoin d'un CLI local / shell desktop ? | Non | Oui (installer Electron) | Oui (npm + un des 13 CLI) | **Non — ouvrez la page dans un navigateur** |
| Fidélité structurelle à l'original | 100 % | Moyenne (agent sur un runtime desktop, pas le web) | Moyenne (agent dans le CLI utilisateur, spawné par le daemon) | **Élevée — agent dans le navigateur + backend comme stockage, même forme que l'original** |
| Licence | Closed | MIT | Apache-2.0 | Apache-2.0 |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

En résumé : **open-codesign et nexu-io sont local-first (agent sur le desktop ou dans le CLI utilisateur, fichiers sur disque) ; nous et le Claude Design original sommes web-first (agent dans le navigateur, fichiers dans un backend cloud)**. Chacun a ses trade-offs — on a choisi celui le plus structurellement aligné avec ce qu'Anthropic ship réellement.

## Remerciements

Ce projet est bâti sur le travail de beaucoup d'autres gens.

**[Claude Design d'Anthropic](https://claude.ai/design)** est le produit que Open Claude Design recrée. On a un respect énorme pour ce que l'équipe d'origine a construit et pour le niveau qu'ils ont posé — chaque couche de l'expérience reflète à quel point ils ont fait attention. Ce codebase, c'est le processus de chercher à atteindre ce niveau.

On veut aussi remercier deux autres projets open-source dans cet espace :

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — pour le travail open-source substantiel et soigneusement réfléchi qu'ils ont investi dans cette direction.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — pour avoir publié ouvertement leur propre approche du même problème.

Les deux ont enrichi la conversation open-source autour de ce produit, et on est reconnaissants qu'ils existent.

### Outillage

- [Vercel AI SDK](https://github.com/vercel/ai) — abstraction multi-provider qui permet à l'agent loop de tourner dans un tab navigateur.
- [React](https://react.dev/) et [Babel](https://babeljs.io/) — les builds UMD qui font tourner le runtime de prévisualisation in-iframe.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/) et [R2](https://developers.cloudflare.com/r2/) — le backend sans serveur à faire tourner.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/), et le reste de la chaîne TypeScript / npm-workspaces.

## Avis légal

Open Claude Design est un projet open-source recréé par la communauté. **Ce projet n'est ni affilié, ni approuvé, ni sponsorisé par Anthropic.** « Claude » et « Claude Design » sont des marques déposées d'Anthropic, PBC.

Une partie du guidage comportemental de l'agent — spécifiquement le contenu du system prompt sous [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — est adaptée d'observations du runtime public Claude Design d'Anthropic. Nous conservons ce contenu sous une justification de fair use / interopérabilité, pour garder la recréation open-source fidèle à la surface originale.

**Si quelqu'un chez Anthropic souhaite voir retiré ou réécrit l'un des contenus, nous le ferons promptement** — veuillez ouvrir une issue sur [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) ou contacter le mainteneur du dépôt.

## Ce que ça fait

- **Chat → générer** un prototype React multi-fichiers, streamé token par token dans le workspace du projet.
- **Tweaks** : les design tokens définis par l'artifact deviennent des sliders / color pickers live — ajustez en place, sans re-prompt.
- **Comment** : épinglez des annotations à des coordonnées sur la prévisualisation ; renvoyez le contexte épinglé à l'agent pour des réécritures ciblées.
- **Edit** : cliquez n'importe quel élément, modifiez les inline styles ou les classes Tailwind dans un inspector flottant, persistez dans les fichiers source.
- **Draw** : esquissez à la main par-dessus la prévisualisation ; les traits et une capture d'écran montent dans le tour suivant pour que le modèle puisse agir sur votre indication.
- **Projets multi-fichiers** (`.jsx` / `.html` / `.css`) rendus via Babel Standalone dans une iframe sandboxée — la résolution de l'entry préfère `.html`, puis `.jsx`/`.tsx`.
- **Importable** — déposez un export ZIP de Claude-Design sur le workspace et continuez à éditer là où Anthropic s'est arrêté.

## Stack

- **Frontend** — Vite + React 18.3.1 + React Router v6 + styled-components
- **Backend** — [Hono](https://hono.dev/) sur Cloudflare Workers
- **Storage** — Cloudflare D1 (métadonnées) + R2 (blobs sha256-addressed)
- **AI** — Le `ToolLoopAgent` du [Vercel AI SDK](https://github.com/vercel/ai) tourne dans le navigateur, en appelant OpenRouter ou n'importe lequel des 10 providers first-party directement avec le key de l'utilisateur
- **Wire** — HTTP REST + SSE, schemas verrouillés dans [`packages/contracts`](packages/contracts/)
- **Tests** — Vitest (unit + integration) et Playwright (e2e)

## Développement local

**Prérequis** : Node 22+, npm 10+. Pas besoin de compte Cloudflare — `wrangler` fait tourner D1 en mode `--local` contre un fichier SQLite sous `.wrangler/state/`.

Collez ce bloc entier dans un nouveau terminal :

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # ~1 min au premier run : installe les deps + applique les migrations D1
npm run dev      # web sur :5173, api sur :8787 (Ctrl-C pour arrêter)
```

Quand le dev server est up, ouvrez <http://localhost:5173>. Le premier message de chat vous demandera un OpenRouter API key — récupérez-en un sur [openrouter.ai/keys](https://openrouter.ai/keys) et collez-le. Le key vit uniquement dans le `localStorage` du navigateur ; effacez-le ou changez-le à tout moment depuis `/settings`.

Pour les sessions suivantes, juste `npm run dev` — `setup` est one-time.

> Sanity check : `curl http://localhost:8787/health` → `200 {"ok":true,...}`.

## Auto-hébergement sur Cloudflare

> Vous apportez un compte Cloudflare ; vos utilisateurs apportent leur propre LLM key.

```bash
npm run cf:provision    # one-time : wrangler login + crée D1 / R2 / applique le schema
npm run deploy          # à chaque fois : ship Worker (API) + Pages (SPA)
```

Après que `npm run deploy` ait fini, vous aurez `https://open-design-web.pages.dev` (SPA) et `https://open-design-api.<your-subdomain>.workers.dev` (API).

Ce que `cf:provision` fait, en un seul shot : vous logge dans Cloudflare (skip si déjà fait), crée la database D1 `open-design` et écrit son `database_id` dans [`apps/api/wrangler.toml`](apps/api/wrangler.toml), crée le bucket R2 `open-design-blobs`, applique le schema D1.

Ce que `deploy` fait : deploy le Worker, vendor React + les bundles UMD Babel dans `apps/web/public/vendor/` pour que les prévisualisations marchent offline / derrière des firewalls / sous CSP strict, build le SPA, ship vers Cloudflare Pages (projet `open-design-web`).

Ou bien sautez le deploy manuel et utilisez le GitHub Action embarqué — un push sur `main` déclenche `.github/workflows/deploy.yml` une fois que vous avez ajouté `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` aux secrets du repo. Le workflow no-op sans eux, donc un fork vanilla est safe.

## Structure du repo

```
open-claude-design/
├── apps/
│   ├── web/                — Frontend (Vite + React + styled-components)
│   │   └── src/features/
│   │       ├── chat/       — ToolLoopAgent côté navigateur + tools + system prompts
│   │       ├── preview/    — Iframe + overlays Tweaks/Comment/Edit/Draw
│   │       ├── workspace/  — Workspace de fichiers multi-tab + état du projet
│   │       ├── home/       — Landing, sélecteur de projets, galerie d'exemples
│   │       └── settings/   — Gestion des keys BYOK
│   └── api/                — Backend (Hono sur Cloudflare Workers + D1 + R2)
├── packages/
│   ├── contracts/          — Wire contracts TypeScript partagés (source unique de vérité)
│   ├── design-tokens/      — Tokens color/typography (TS + CSS dual-source)
│   └── iframe-runtime/     — Overlay in-iframe + bridge Tweaks (zéro deps runtime, pure string assembly)
└── e2e/                    — Suite end-to-end Playwright
```

## Contribuer

Les PRs sont bienvenues. Le projet est en pre-alpha et la barre pour contribuer est lâche.

```bash
npm install
npm run typecheck   # tsc --noEmit sur tout le workspace
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright (nécessite `npm run dev` qui tourne)
```

Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour les conventions de branches, les conventions de commit, et un parcours guidé à travers le codebase.

## License

[Apache License 2.0](LICENSE) — fork, modifiez, ship.
