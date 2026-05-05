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
  <a href="#développement-local"><img alt="Dev local" src="https://img.shields.io/badge/dev%20local-collez%20un%20bloc-green?style=flat-square" /></a>
  <a href="#auto-hébergement-sur-cloudflare"><img alt="Auto-hébergement" src="https://img.shields.io/badge/auto--hébergement-collez%20un%20bloc-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es-ES.md">Español</a> · <b>Français</b> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">Par <a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **Statut : pre-alpha.** L'architecture est stabilisée et les quatre outils de prévisualisation fonctionnent de bout en bout, mais des breaking changes peuvent encore tomber dans n'importe quelle release. Épinglez un commit si vous dépendez du wire format.

## Pourquoi ce projet existe

[Claude Design](https://claude.ai/design) d'Anthropic a transformé un LLM en un outil qui livre des artifacts de design interactifs : chat en entrée, prototype React multi-fichiers en sortie, édition de n'importe quel élément en place, ship. C'est devenu viral et c'est resté closed-source, payant, cloud-only, verrouillé sur la stack d'Anthropic.

**Open Claude Design est une recréation open-source fidèle de cette surface, avec la même ossature technique.** Quand un choix s'imposait, on s'est appuyé sur ce qu'Anthropic a réellement publié — le format d'artifact, le bloc Tweaks `EDITMODE`, la convention de sub-agent `<uuid>::verifier`, le pipeline de prévisualisation in-iframe via Babel-Standalone, la grammaire `postMessage` des quatre outils (`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …). La plus grosse source d'inspiration de ce code, c'est de lire ce qu'Anthropic a publié.

On diverge de Claude Design dans une seule direction : **pure web, pas d'enveloppe, pas de SaaS.** Tout tourne dans un tab navigateur plus un seul Cloudflare Worker. L'agent de chat (la tool-loop du [Vercel AI SDK](https://github.com/vercel/ai)) s'exécute _dans votre tab_ et parle directement à OpenRouter avec votre key — le Worker fait uniquement du stockage et ne voit jamais vos prompts. Ce trade-off achète trois choses :

1. **Deploy en un bloc de commandes sur un compte Cloudflare gratuit** — pas de Postgres, pas de Redis, pas d'ECS, pas de Docker.
2. **Pas de comptes, pas de SaaS partagé, pas de quota** — fork, deploy, envoyez le lien à vos amis.
3. **Un codebase lisible** — TS strict, npm workspaces, ~10 dossiers source. Les parties intéressantes (iframe runtime, protocole `EDITMODE`, agent loop côté navigateur) tiennent dans un week-end de lecture.

## Remerciements

Ce projet est bâti sur le travail de beaucoup d'autres gens.

**[Claude Design d'Anthropic](https://claude.ai/design)** est le produit que Open Claude Design recrée. On a un respect énorme pour ce que l'équipe d'origine a construit et pour le niveau qu'ils ont posé — chaque couche de l'expérience reflète à quel point ils ont fait attention. Ce codebase, c'est le processus de chercher à atteindre ce niveau.

On veut aussi remercier deux autres projets open-source dans cet espace :

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — pour le travail open-source substantiel et soigneusement réfléchi qu'ils ont investi dans cette direction.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — pour avoir publié ouvertement leur propre approche du même problème.

Les deux ont enrichi la conversation open-source autour de ce produit, et on est reconnaissants qu'ils existent.

### Outillage

- [Vercel AI SDK](https://github.com/vercel/ai) — abstraction multi-provider qui permet à l'agent loop de tourner dans un tab navigateur.
- [OpenRouter](https://openrouter.ai/) — un seul BYOK key devant des dizaines de providers LLM.
- [React](https://react.dev/) et [Babel](https://babeljs.io/) — les builds UMD qui font tourner le runtime de prévisualisation in-iframe.
- [Cloudflare Workers](https://workers.cloudflare.com/), [D1](https://developers.cloudflare.com/d1/) et [R2](https://developers.cloudflare.com/r2/) — le backend sans serveur à faire tourner.
- [Hono](https://hono.dev/), [Vite](https://vitejs.dev/), [Turbo](https://turbo.build/), et le reste de la chaîne TypeScript / npm-workspaces.

## Avis légal

Open Claude Design est un projet open-source recréé par la communauté. **Ce projet n'est ni affilié, ni approuvé, ni sponsorisé par Anthropic.** « Claude » et « Claude Design » sont des marques déposées d'Anthropic, PBC.

Une partie du guidage comportemental de l'agent — spécifiquement le contenu du system prompt sous [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — est adaptée d'observations du runtime public Claude Design d'Anthropic. Nous conservons ce contenu sous une justification de fair use / interopérabilité, pour garder la recréation open-source fidèle à la surface originale.

**Si quelqu'un chez Anthropic souhaite voir retiré ou réécrit l'un des contenus, nous le ferons promptement** — veuillez ouvrir une issue sur [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) ou contacter le mainteneur du dépôt.

## En un coup d'œil

| | Ce que vous obtenez |
|---|---|
| **Forme** | Pure web — Vite SPA + un seul Cloudflare Worker. Pas d'Electron, pas de daemon local, pas d'install native. |
| **Runtime AI** | Le `ToolLoopAgent` du Vercel AI SDK tourne **dans le tab navigateur**. Les tools (`edit_file` / `read_file` / `list_files` / `mark_done`) appellent l'API REST du Worker pour persister les fichiers ; le Worker ne voit jamais les prompts ni les keys. |
| **Providers** | OpenRouter est le fan-out par défaut (un key → Anthropic, OpenAI, Google, Mistral, xAI, DeepSeek, Groq, Cerebras, …). Les SDK directs des providers sont aussi câblés : `@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}` plus n'importe quel endpoint compatible OpenAI. Les keys vivent dans `localStorage`. |
| **Storage** | Cloudflare **D1** (SQLite) pour les métadonnées + **R2** pour les blobs de fichiers content-addressed sha256. Un seul Worker bind les deux. Le free tier suffit largement pour des projets perso. |
| **Surface de prévisualisation** | Une iframe sandboxée qui rend React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 — assemblée depuis un `srcdoc` pure-string. Zéro fuite de runtime React/npm dans la prévisualisation. Les bundles UMD peuvent être vendored pour des deploys offline / strict-CSP. |
| **Tweaks** | Les artifacts émettent un bloc `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` qui déclare des design tokens ajustables. L'UI hôte expose des sliders / pickers ; les changements remontent en événements `EDIT_STYLE` `postMessage` sans relancer le modèle. |
| **Comment** | Posez des pins n'importe où sur la prévisualisation live, écrivez un commentaire, envoyez le contexte du pin à l'agent pour une réécriture ciblée. |
| **Edit** | Cliquez n'importe quel élément DOM — l'inspector flotte, vous tweakez les inline styles ou les classes Tailwind, le changement persiste dans les fichiers du projet. |
| **Draw** | Esquissez sur la prévisualisation avec un outil pen ; les traits plus une capture d'écran sont envoyés au modèle pour qu'il réécrive depuis votre indication dessinée à la main. |
| **Wire** | HTTP REST + Server-Sent Events. Source unique de vérité dans [`packages/contracts`](packages/contracts/) — chaque type d'événement SSE, type de postMessage, et shape de route y est un littéral. |
| **License** | Apache-2.0 |

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

> Vous apportez un compte Cloudflare ; vos utilisateurs apportent leur propre LLM key. On ne fait pas tourner de SaaS hébergé.

```bash
npm run cf:provision    # one-time : wrangler login + crée D1 / R2 / applique le schema
npm run deploy          # à chaque fois : ship Worker (API) + Pages (SPA)
```

Après que `npm run deploy` ait fini, vous aurez `https://open-design-web.pages.dev` (SPA) et `https://open-design-api.<your-subdomain>.workers.dev` (API).

Ce que `cf:provision` fait, en un seul shot : vous logge dans Cloudflare (skip si déjà fait), crée la database D1 `open-design` et écrit son `database_id` dans [`apps/api/wrangler.toml`](apps/api/wrangler.toml), crée le bucket R2 `open-design-blobs`, applique le schema D1.

Ce que `deploy` fait : deploy le Worker, vendor React + les bundles UMD Babel dans `apps/web/public/vendor/` pour que les prévisualisations marchent offline / derrière des firewalls / sous CSP strict, build le SPA, ship vers Cloudflare Pages (projet `open-design-web`).

Ou bien sautez le deploy manuel et utilisez le GitHub Action embarqué — un push sur `main` déclenche `.github/workflows/deploy.yml` une fois que vous avez ajouté `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` aux secrets du repo. Le workflow no-op sans eux, donc un fork vanilla est safe.

### Domaine personnalisé

Dans le dashboard Cloudflare, attachez un domaine personnalisé au projet Pages (par ex. `design.example.com`) et au Worker (par ex. `api.design.example.com`). Le SPA s'attend à ce que `/api/*` atteigne le Worker — configurez une route Pages Function ou un rewrite via l'UI Cloudflare Routes pour ce path.

Ajoutez l'origin du SPA aux `[vars] ALLOWED_ORIGINS` du Worker dans [`apps/api/wrangler.toml`](apps/api/wrangler.toml) (séparés par des virgules), puis redeployez le Worker — sinon CORS bloquera les requests.

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

Les PRs sont bienvenues. Le projet est en pre-alpha et la barre pour contribuer est lâche — corrigez un typo, déposez un bug, esquissez une feature.

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
