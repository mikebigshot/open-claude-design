# Open Claude Design

> **[Claude Design](https://claude.ai/design) をオープンソースの純粋な Web アプリとして再実装。** Chat ドリブンの複数ファイル React プロトタイピング作業台に **Tweaks · Comment · Edit · Draw** という 4 つのインプレース・プレビューツールを搭載。Agent はあなたのブラウザ tab で動作し、ファイルの保管は 1 つの Cloudflare Worker（D1 + R2）が担当。Electron もローカル daemon もサーバサイドの LLM プロキシもありません。

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Status" src="https://img.shields.io/badge/ステータス-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/技術スタック-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#ローカル開発"><img alt="ローカル開発" src="https://img.shields.io/badge/ローカル開発-1ブロック貼り付け-green?style=flat-square" /></a>
  <a href="#cloudflare-セルフホスト"><img alt="セルフホスト" src="https://img.shields.io/badge/セルフホスト-1ブロック貼り付け-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <b>日本語</b> · <a href="README.ko.md">한국어</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center">作者：<a href="https://www.imsai.cc/">imsai</a></p>

---

> ⚠️ **ステータス: pre-alpha。** アーキテクチャは安定し、4 つのプレビューツールはエンドツーエンドで動作しますが、wire プロトコルは任意の release で breaking change が入る可能性があります。プロトコルのリテラルに依存する場合は commit を pin してください。

## なぜこのプロジェクトを作ったか

Anthropic の [Claude Design](https://claude.ai/design) は LLM を、インタラクティブなデザイン成果物を届けるツールへと変えました。chat で投げると、複数ファイルの React プロトタイプが返り、任意の要素を直接いじって、そのまま ship できる。瞬く間に話題になった一方で、**クローズドソース**、有料、クラウド限定、Anthropic のスタックに固定されたままです。

**Open Claude Design はその表層をオープンソースで忠実に再現したもので、技術骨格は公式実装に揃えています。** トレードオフが発生する箇所では、まず Anthropic が実際に出したもの（artifact のフォーマット、`EDITMODE` Tweaks ブロック、`<uuid>::verifier` というサブ agent の命名規則、iframe 内の Babel-Standalone レンダリング、4 つのツールの `postMessage` 構文（`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …））を参照しました。このコードベース最大の単一インプットは、Anthropic がすでに公開しているランタイムを読み解くことです。

**Claude Design と同様に、agent loop はブラウザ tab に留まり、chat / files / project state は自分のバックエンドへ同期されます。** これは原作との構造的な一致点として最も重要なポイントです — Anthropic のクラウドは LLM パススルー + tool 実行 + project スナップショットの保管庫に過ぎず、agent loop 自体はブラウザの SPA で動作しています。私たちも同じ形を取ります: [Vercel AI SDK](https://github.com/vercel/ai) の tool loop はあなたの tab で動作し、chat / files / project state は Cloudflare Worker を経由して D1 + R2 に流れ込み、Worker はあなたの prompt を一切見ません。この **web-agent + backend-storage** の形は、まさに SaaS へとスケールしていく形でもあります。

## アーキテクチャ

> このセクションは本コードベースの暗黙の仕様書です。記述内容は 2026-04 に `claude.ai/design` へログインして行った調査 — DOM 検査、ネットワークキャプチャ、グローバル変数読み取り、ダウンロードした artifact、難読化解除されたランタイム、動作する POC — から得られたものです。直接観察された事実に忠実であろうと努めています。

### Claude Design の構造

形は Claude Code と同じ: ブラウザが agent をホストし、クラウドは LLM ゲートウェイ + tool バックエンドに過ぎません。1 ターンの Chat リクエストボディは Anthropic Messages API への直接パススルー（完全な system + tools + 全 messages がクライアント側で組み立てられる）です。クラウドの `OmeletteService` は **会話状態を保持しません** — LLM に中継し、tool を実行し、project スナップショットを保存するだけです。

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

#### 主要な観察

| 軸 | 実際の出荷物 |
|---|---|
| メインアプリ frontend | Vite + React Router v6 + styled-components；コードエディタはネイティブ `<textarea>` + 手書きの `<div>` 行番号 — Monaco も CodeMirror も使っていない |
| バックエンドプロトコル | Connect / gRPC-Web + Protobuf；service 名 `anthropic.omelette.api.v1alpha.OmeletteService` |
| Agent ツールプロトコル | MCP（Model Context Protocol） — `defer_loading` フィールド付きの完全な `tools/list` ペイロードをキャプチャ済み；サードパーティ MCP サーバが本当にプラグインできる |
| Tool ルーティング | 30+ 個の tool が 9 つのバケットに振り分けられる: クラウド RPC（EditFile / GetFile / …）/ ローカル FSA（local_*）/ iframe DOM（show_html / eval_js / screenshot）/ 純粋なクライアントロジック（snip / update_todos）/ spawn したサブ agent / サードパーティ MCP / LLM 組み込み（web_search / web_fetch） |
| Verifier サブ agent | メイン agent の **system prompt + tool セット + 履歴** を共有；fork の実体は fork tool_result に押し込まれる role-reset prompt + sessionUUID への `::verifier` サフィックス + max_tokens 半減、それだけ |
| プレビュー iframe | 各 project 専用のサブドメイン `{project-uuid}.claudeusercontent.com`；メインサイトは CSP `default-src 'none'; frame-ancestors 'none'` を設定；プレビュートークンは 4 セグメント: `{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}` |
| 生成 artifact のランタイム | React **18.3.1** + Babel Standalone **7.29.0**（UMD、integrity hash で固定）+ inline `style={{...}}` JS オブジェクト + Google Fonts + マルチ JSX `<script type="text/babel" src="*.jsx">` を global window にマウント |
| Tweaks プロトコル | Artifact に `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` ブロックを埋め込み + `EDIT_STYLE` postMessage でモデルを再実行せずにライブで書き戻す |
| クライアント権威ストレージ | ブラウザが完全な chats / messages / contentBlocks / tool 入出力 / viewState / assets manifest を保持し、`UpdateProjectData` 経由で完全スナップショットを push back する。**全ての tool 呼び出しの input/output が永続化される** |
| `done` 複合操作 | EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData の連鎖をトリガする |
| ストリーミング | ネイティブな Anthropic SSE ではなく、OmeletteService がカスタムフレームに再ラップ: `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` |
| ローカルフォルダブリッジ | File System Access API + 4 つの `local_*` tool（local_ls / local_read / local_grep / local_copy_to_project）；ローカルファイルは **絶対に** OmeletteService に届かない — LLM コンテキストにのみ現れる |

### Open Claude Design の構造

その図をそのまま受け継ぎます: agent loop はブラウザ、クラウドはストレージ専用。全体の形は原作と一致しており、私たちはエンジニアリング上のトレードオフのみを単純化しています（Connect / gRPC-Web の代わりに HTTP REST、独自バックエンドの代わりに Cloudflare Worker、ホスト型 key の代わりに BYOK）。

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

#### 原作から受け継いだもの

- **ブラウザ側 agent loop** — Vercel AI SDK の `ToolLoopAgent` が tab の中で動作（原作の agent フレームワークは非公開だが、ホスト先は同じ）
- **クライアント権威 + バックエンドスナップショット** — D1 が project メタデータを保持し、R2 が sha256 content-addressed blob を保持、完全スナップショットとして書き込まれる
- **プレビュー iframe ランタイム** — React 18.3.1 + Babel Standalone 7.29.0、同じバージョンと integrity hash、マルチ JSX エントリのセマンティクスを維持
- **プロトコルリテラル** — Tweaks の `EDITMODE-BEGIN/END`、`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` のような postMessage type、`<uuid>::verifier` のサブ agent 命名規則 — すべてそのまま保持

#### 意図的に分岐させたところ

- **Wire プロトコル** — Connect / gRPC-Web から HTTP REST + SSE に簡素化（schema は [`packages/contracts`](packages/contracts/) にあり、`.proto` 流用なし）
- **フォント** — 商用の Anthropic Serif を Google Fonts（Inter / Instrument Serif / JetBrains Mono）に置換；アイコンは Lucide
- **プレビューサブドメイン** — `*.claudeusercontent.com` を Cloudflare Pages のデフォルトサブドメインに置換（セルフホスト時は自前ドメインを持ち込み）
- **ローカルフォルダブリッジ / サードパーティ MCP / verifier サブ agent** — 未実装（roadmap）

## nexu-io/open-design および OpenCoworkAI/open-codesign との違い

3 つのプロジェクトはいずれも Claude Design のオープンソース再実装です。違いは主に **agent loop がどこで動き、chat / files がどこに収まるか** にあります。

|  | Claude Design（原作） | [open-codesign][ocod] | [nexu-io/open-design][nexu] | **Open Claude Design** |
|---|---|---|---|---|
| 形態 | Web（claude.ai） | Desktop（Electron） | Web アプリ + ローカル daemon | **純粋な Web + Cloudflare Workers** |
| Agent loop の動作場所 | ブラウザ tab | Electron メインプロセス内、[pi-ai] を同梱 | ディスク上にすでにある CLI（Claude Code / Codex / Cursor / Gemini / … 13 種類のアダプタ） | **ブラウザ tab（Vercel AI SDK ToolLoopAgent、BYOK）** |
| Chat / files の保管場所 | クラウド（OmeletteService + content-addressed blob） | ローカル SQLite + ローカルファイルシステム | ローカル SQLite + ローカルファイルシステム | **Cloudflare D1 + R2（あなたのアカウント）** |
| ローカル CLI / desktop シェルが必要か？ | 不要 | 必要（Electron インストーラ） | 必要（npm + 13 種の CLI のいずれか） | **不要 — ブラウザでページを開くだけ** |
| 原作との構造的忠実度 | 100% | 中（agent が desktop ランタイム上、Web ではない） | 中（agent がユーザの CLI 内、daemon が spawn） | **高 — agent はブラウザ + バックエンドはストレージ、原作と同じ形** |
| ライセンス | クローズド | MIT | Apache-2.0 | Apache-2.0 |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

要するに: **open-codesign と nexu-io はローカルファースト（agent が desktop もしくはユーザの CLI、ファイルはディスク）；私たちと原作の Claude Design は Web ファースト（agent がブラウザ、ファイルはクラウドバックエンド）** です。それぞれにトレードオフがあり — 私たちは Anthropic が実際に出したものに最も構造的に近いものを選びました。

## 謝辞

このプロジェクトは多くの方の仕事の上に成り立っています。

**[Anthropic の Claude Design](https://claude.ai/design)** こそ、Open Claude Design が再現したい対象です。原作チームが作り上げたもの、引いた基準線には心からの敬意を抱いています。体験のあらゆるレイヤーから、彼らがどれだけ細部に心を配ったかが伝わってきます。このコードはその基準線へ近づこうとし続けるプロセスそのものです。

同じ方向を向くもう 2 つのオープンソースプロジェクトにも感謝を伝えたいです:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — この方向性へ堅実かつ周到に取り組んだオープンソースエンジニアリングに感謝します。
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — 同じ問題に対するオープンソース実装を率直に公開してくれたことに感謝します。

これらの存在のおかげで「オープンソースで再実装する」という議論はより豊かになりました。両プロジェクトの存在に心から感謝しています。

### ツールチェーン

- [Vercel AI SDK](https://github.com/vercel/ai) — マルチ provider 抽象。これにより agent loop がブラウザ tab で動かせます。
- [React](https://react.dev/) と [Babel](https://babeljs.io/) — UMD build がブラウザ内のプレビューランタイムを支えます。
- [Cloudflare Workers](https://workers.cloudflare.com/)、[D1](https://developers.cloudflare.com/d1/)、[R2](https://developers.cloudflare.com/r2/) — サーバレスのバックエンド。
- [Hono](https://hono.dev/)、[Vite](https://vitejs.dev/)、[Turbo](https://turbo.build/)、そしてより広い TypeScript / npm-workspaces のツールチェーン。

## 免責事項

Open Claude Design はコミュニティ主導のオープンソース再現プロジェクトです。**本プロジェクトは Anthropic と提携・公認・スポンサー関係にはありません。** "Claude" および "Claude Design" は Anthropic, PBC の商標です。

agent の振る舞いに関するガイダンスの一部 — 具体的には [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) 配下の system prompt 内容 — は、Anthropic が公開している Claude Design ランタイムの観察に基づいて改変したものです。「fair use / 相互運用性」を根拠に、オープン再現を原作の表面にできるだけ忠実にするためにこの内容を保持しています。

**Anthropic 側からこの内容の削除や書き換えのご要望があれば、直ちに対応いたします** — [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) にて issue を立てるか、メンテナまでご連絡ください。

## できること

- **Chat → 生成**: 自然言語で記述すると、AI が複数ファイルの React プロトタイプをストリーミング生成し、token が出力されるそばから workspace に書き出されます。
- **Tweaks**: artifact 自身が宣言したデザイン token がリアルタイムのスライダー / カラーピッカーになる — その場で調整、再 prompt 不要。
- **Comment**: プレビュー上の任意の座標に pin を打ってコメントを書くと、pin のコンテキストが一緒に agent へ戻ってピンポイントな書き換えに使われます。
- **Edit**: 要素をクリックすると、フローティングの inspector で inline スタイルや Tailwind クラスを編集でき、変更はソースファイルに反映されます。
- **Draw**: プレビュー上にスケッチを手描きすると、筆跡 + スクリーンショットが次のターンの入力となり、モデルがそれに沿って修正します。
- **複数ファイルのプロジェクト**（`.jsx` / `.html` / `.css`）を Babel Standalone 経由で sandbox iframe にレンダリング — entry ファイルは `.html` > `.jsx`/`.tsx` の優先順位で解決されます。
- **インポート可能** — Claude Design がエクスポートした ZIP を workspace にドラッグすれば、Anthropic が止めたところから agent が編集を続けます。

## 技術スタック

- **フロントエンド** — Vite + React 18.3.1 + React Router v6 + styled-components
- **バックエンド** — Cloudflare Workers 上の [Hono](https://hono.dev/)
- **ストレージ** — Cloudflare D1（メタデータ）+ R2（sha256 コンテンツアドレッシング blob）
- **AI** — [Vercel AI SDK](https://github.com/vercel/ai) の `ToolLoopAgent` がブラウザで動作し、ユーザの key で直接 OpenRouter / 第一線の 10 社の provider を叩きます
- **Wire** — HTTP REST + SSE、schema は [`packages/contracts`](packages/contracts/) で固定
- **テスト** — Vitest（unit + integration）+ Playwright（e2e）

## ローカル開発

**前提**: Node 22+、npm 10+。Cloudflare アカウントは不要 — `wrangler` の `--local` モードは `.wrangler/state/` 配下のローカル SQLite を使います。

下記をまるごと新しいターミナルにコピーしてください:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # 初回約 1 分: 依存インストール + D1 migration の適用
npm run dev      # web :5173、api :8787（Ctrl-C で停止）
```

dev server が起動したら <http://localhost:5173> を開きます。最初の chat 送信時に OpenRouter API key の貼り付けを求められます — [openrouter.ai/keys](https://openrouter.ai/keys) で取得して貼り付けてください。Key はブラウザの `localStorage` にのみ保存されます。クリアや差し替えは `/settings` から行えます。

以降の起動は `npm run dev` 1 本だけ — `setup` は一度きりです。

> Sanity check: `curl http://localhost:8787/health` → `200 {"ok":true,...}`。

## Cloudflare セルフホスト

> Cloudflare アカウントはあなたが用意し、ユーザは自分の LLM key を用意します。

```bash
npm run cf:provision    # 初回限定: wrangler login + D1 / R2 作成 + schema 適用
npm run deploy          # 毎回: Worker（API） + Pages（SPA）をデプロイ
```

`npm run deploy` が完走すると `https://open-design-web.pages.dev`（SPA） + `https://open-design-api.<your-subdomain>.workers.dev`（API）が手に入ります。

`cf:provision` が一度に行うこと: Cloudflare へ自動ログイン（既ログインならスキップ）、`open-design` D1 データベース作成と `database_id` の [`apps/api/wrangler.toml`](apps/api/wrangler.toml) への書き戻し、`open-design-blobs` R2 bucket の作成、D1 schema のリモート適用。

`deploy` が一度に行うこと: Worker のデプロイ、React + Babel UMD bundle の `apps/web/public/vendor/` への vendor（プレビューがオフライン / イントラネット / 厳格な CSP 下でも動作するように）、SPA の build、Cloudflare Pages（プロジェクト `open-design-web`）への push。

あるいは同梱の GitHub Action を使う方法もあります — `main` への push で `.github/workflows/deploy.yml` がトリガされます。前提として、リポジトリの secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を設定しておく必要があります（この 2 つが欠けている場合は workflow が no-op になるので、フォーク先の repo が落ちることはありません）。

## リポジトリ構成

```
open-claude-design/
├── apps/
│   ├── web/                — フロントエンド（Vite + React + styled-components）
│   │   └── src/features/
│   │       ├── chat/       — ブラウザ側 ToolLoopAgent + tools + system prompts
│   │       ├── preview/    — Iframe + Tweaks/Comment/Edit/Draw のオーバーレイ
│   │       ├── workspace/  — マルチ tab のファイル workspace + プロジェクト state
│   │       ├── home/       — ホームページ、プロジェクトセレクタ、サンプルギャラリー
│   │       └── settings/   — BYOK key 管理
│   └── api/                — バックエンド（Cloudflare Workers 上の Hono + D1 + R2）
├── packages/
│   ├── contracts/          — フロント / バックエンド共有の TypeScript wire 契約（単一のソース）
│   ├── design-tokens/      — color / typography token（TS + CSS の二重ソース）
│   └── iframe-runtime/     — iframe に注入する overlay + Tweaks bridge（ランタイム依存ゼロ、純粋な文字列連結）
└── e2e/                    — Playwright のエンドツーエンドスイート
```

## コントリビュート

PR を歓迎します。pre-alpha なのでコントリビュートのハードルは低めです。

```bash
npm install
npm run typecheck   # workspace 全体で tsc --noEmit
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright（先に `npm run dev` を起動しておく必要あり）
```

ブランチ戦略、commit 規約、新規参加者向けのコード読解パスは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## License

[Apache License 2.0](LICENSE) — fork、改変、ship、自由にどうぞ。
