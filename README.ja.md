# Open Claude Design

> **[Claude Design](https://claude.ai/design) をオープンソースの純粋な Web アプリとして再実装。** Agent ドリブンのプロトタイピング作業台に **Tweaks · Comment · Edit · Draw** という 4 つのインプレース・プレビューツールを搭載。Agent はあなたのブラウザ tab で動作し、ファイルの保管は Cloudflare Worker（D1 + R2）が担当。Electron もローカル daemon もサーバサイドの LLM プロキシもありません。

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

> ⚠️ **ステータス: pre-alpha。** アーキテクチャは安定し、4 つのプレビューツールはエンドツーエンドで動作しますが、wire プロトコルは任意の release で breaking change が入る可能性があります。プロトコルのリテラルに依存する場合は version を固定してください。

## なぜこのプロジェクトを作ったか

Anthropic の [Claude Design](https://claude.ai/design) は LLM を、インタラクティブなデザイン成果物を届けるツールへと変えました。chat で投げると、複数ファイルの React プロトタイプが返り、任意の要素を直接いじって、そのまま ship できる。瞬く間に話題になった一方で、**クローズドソース**で、有料、クラウド限定、Anthropic のスタックに固定されたままです。

**Open Claude Design はその表層をオープンソースで忠実に再現したもので、技術骨格は公式実装に揃えています。** トレードオフが発生する箇所では、まず Anthropic が実際に出したもの（artifact のフォーマット、`EDITMODE` Tweaks ブロック、`<uuid>::verifier` というサブ agent の命名規則、iframe 内の Babel Standalone レンダリング、4 つのツールの `postMessage` 構文（`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …））を参照しました。このコードベース最大の単一インプットは、Anthropic がすでに公開しているランタイムを読み解くことです。

私たちは Claude Design とある一点で道を分けます。**Web のみ、シェルなし、SaaS にしない。** プロダクト全体がブラウザ tab + 1 つの Cloudflare Worker で動作します。Chat agent（[Vercel AI SDK](https://github.com/vercel/ai) の tool-loop）は **あなたのブラウザ tab の中で**実行され、あなたの key で直接 OpenRouter を叩きます。Worker は保管役だけを担い、あなたの prompt を一切見ません。このトレードオフによって 3 つのことが手に入ります:

1. **無料の Cloudflare アカウント + 1 ブロックのコマンドでセルフホスト** — Postgres も Redis も ECS も Docker も不要。
2. **アカウントなし、共有 SaaS なし、quota なし** — fork して deploy して、リンクを友達に送るだけ。
3. **読み切れる量のコード** — 厳格な TS、npm workspaces、ソースフォルダはおよそ 10 個。一番おもしろい部分（iframe runtime、`EDITMODE` プロトコル、ブラウザ側の agent loop）は週末で読み切れます。

## 謝辞

このプロジェクトは多くの方の仕事の上に成り立っています。

**[Anthropic の Claude Design](https://claude.ai/design)** こそ、Open Claude Design が再現したい対象です。原作チームが作り上げたもの、引いた基準線には心からの敬意を抱いています。体験のあらゆるレイヤーから、彼らがどれだけ細部に心を配ったかが伝わってきます。このコードはその基準線へ近づこうとし続けるプロセスそのものです。

同じ方向を向くもう 2 つのオープンソースプロジェクトにも感謝を伝えたいです:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — この方向性へ堅実かつ周到に取り組んだオープンソースエンジニアリングに感謝します。
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — 同じ問題に対するオープンソース実装を率直に公開してくれたことに感謝します。

これらの存在のおかげで「オープンソースで再実装する」という議論はより豊かになりました。両プロジェクトの存在に心から感謝しています。

### ツールチェーン

- [Vercel AI SDK](https://github.com/vercel/ai) — マルチ provider 抽象。これにより agent loop がブラウザ tab で動かせます。
- [OpenRouter](https://openrouter.ai/) — BYOK key 1 本で数十社の LLM provider をまとめて使える。
- [React](https://react.dev/) と [Babel](https://babeljs.io/) — UMD build がブラウザ内のプレビューランタイムを支えます。
- [Cloudflare Workers](https://workers.cloudflare.com/)、[D1](https://developers.cloudflare.com/d1/)、[R2](https://developers.cloudflare.com/r2/) — サーバレスのバックエンド。
- [Hono](https://hono.dev/)、[Vite](https://vitejs.dev/)、[Turbo](https://turbo.build/)、そしてより広い TypeScript / npm-workspaces のツールチェーン。

## 免責事項

Open Claude Design はコミュニティ主導のオープンソース再現プロジェクトです。**本プロジェクトは Anthropic と提携・公認・スポンサー関係にはありません。** "Claude" および "Claude Design" は Anthropic, PBC の商標です。

agent の振る舞いに関するガイダンスの一部 — 具体的には [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) 配下の system prompt 内容 — は、Anthropic が公開している Claude Design ランタイムの観察に基づいて改変したものです。「fair use / 相互運用性」を根拠に、オープン再現を原作の表面にできるだけ忠実にするためにこの内容を保持しています。

**Anthropic 側からこの内容の削除や書き換えのご要望があれば、直ちに対応いたします** — [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) にて issue を立てるか、メンテナまでご連絡ください。

## 概要

| | 手に入るもの |
|---|---|
| **形態** | 純粋な Web — Vite SPA + 1 つの Cloudflare Worker。Electron / ローカル daemon / ネイティブインストーラなし。 |
| **AI ランタイム** | Vercel AI SDK の `ToolLoopAgent` が**ブラウザ tab の中で**動作。Tools（`edit_file` / `read_file` / `list_files` / `mark_done`）が Worker の REST API を叩いてファイルを保存。Worker は prompt も key も一切見ません。 |
| **Provider** | OpenRouter を第一の fan-out として推奨（key 1 本で Anthropic / OpenAI / Google / Mistral / xAI / DeepSeek / Groq / Cerebras …）。直結 SDK もすべて接続済み: `@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}`、加えて任意の OpenAI 互換エンドポイント。Key はすべて `localStorage` に保存されます。 |
| **ストレージ** | Cloudflare **D1**（SQLite）にメタデータ + **R2** に sha256 コンテンツアドレッシングのファイル blob。1 つの Worker に両方を bind。無料枠でほとんどの個人プロジェクトは収まります。 |
| **プレビュー面** | sandbox 化された iframe で React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 を実行 — 純粋な文字列連結で組み立てた `srcdoc` でロード。React / npm のランタイム依存リークはゼロ。本番 / オフライン / 厳格な CSP の場面では UMD bundle を vendor できます。 |
| **Tweaks** | Artifact に埋め込まれた `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` ブロックが調整可能なデザイン token を宣言。ホスト UI がそれをスライダーやカラーピッカーとしてレンダリングし、変更は `EDIT_STYLE` postMessage 経由でリアルタイムに反映されます。モデルの再実行は不要。 |
| **Comment** | プレビュー上に pin を打ってコメントを書き、その pin のコンテキストを agent に渡してピンポイントな書き換えを行います。 |
| **Edit** | 任意の DOM 要素をクリック — ポップアップが開いて inline スタイルや Tailwind クラス名を編集でき、変更はプロジェクトのソースファイルに永続化されます。 |
| **Draw** | プレビュー上にブラシツールで線を描く。筆跡 + スクリーンショットを次のターンの入力として渡し、モデルにあなたの手描きスケッチに沿って修正させます。 |
| **Wire プロトコル** | HTTP REST + Server-Sent Events。単一のソースは [`packages/contracts`](packages/contracts/) — 各 SSE イベントタイプ、postMessage タイプ、ルートの shape はここのリテラルです。 |
| **License** | Apache-2.0 |

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

**前提**: Node 22+、npm 10+。**Cloudflare アカウントは不要** — `wrangler` の `--local` モードは `.wrangler/state/` 配下のローカル SQLite を使います。

下記をまるごと新しいターミナルにコピーしてください:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # 初回約 1 分: 依存インストール + D1 migration の適用
npm run dev      # web :5173、api :8787（Ctrl-C で停止）
```

dev server が起動したら <http://localhost:5173> を開きます。最初の chat 送信時に OpenRouter API key の貼り付けを求められます — [openrouter.ai/keys](https://openrouter.ai/keys) で取得できます。Key はブラウザの `localStorage` にのみ保存されます。クリアや差し替えは `/settings` から行えます。

以降の起動は `npm run dev` 1 本だけ — `setup` は一度きりです。

> Sanity check: `curl http://localhost:8787/health` → `200 {"ok":true,...}`。

## Cloudflare セルフホスト

> Cloudflare アカウントはあなたが用意し、ユーザは自分の LLM key を用意します。私たちはマネージド SaaS を運用しません。

```bash
npm run cf:provision    # 初回限定: wrangler login + D1 / R2 作成 + schema 適用
npm run deploy          # 毎回: Worker（API） + Pages（SPA）をデプロイ
```

`npm run deploy` が完走すると `https://open-design-web.pages.dev`（SPA） + `https://open-design-api.<your-subdomain>.workers.dev`（API）が手に入ります。

`cf:provision` が一度に行うこと: Cloudflare へ自動ログイン（既ログインならスキップ）、`open-design` D1 データベース作成と `database_id` の [`apps/api/wrangler.toml`](apps/api/wrangler.toml) への書き戻し、`open-design-blobs` R2 bucket の作成、D1 schema のリモート適用。

`deploy` が一度に行うこと: Worker のデプロイ、React + Babel UMD bundle の `apps/web/public/vendor/` への vendor（プレビューがオフライン / イントラネット / 厳格な CSP 下でも動作するように）、SPA の build、Cloudflare Pages（プロジェクト `open-design-web`）への push。

あるいは同梱の GitHub Action を使う方法もあります — `main` への push で `.github/workflows/deploy.yml` がトリガされます。前提として、リポジトリの secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を設定しておく必要があります（この 2 つが欠けている場合は workflow が no-op になるので、フォーク先の repo が落ちることはありません）。

### カスタムドメイン

Cloudflare ダッシュボードで Pages プロジェクトにカスタムドメイン（例 `design.example.com`）を、Worker には別のドメイン（例 `api.design.example.com`）を割り当てます。SPA は `/api/*` が worker にルーティングされることを期待します — Pages Function route または Cloudflare Routes UI でそのパスを書き換えてください。

SPA の origin を Worker の [`apps/api/wrangler.toml`](apps/api/wrangler.toml) `[vars] ALLOWED_ORIGINS` に追加（カンマ区切り）して Worker を再 deploy しないと、CORS でリクエストが拒否されます。

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

PR を歓迎します。pre-alpha なのでコントリビュートのハードルは低めです — typo 修正、bug 報告、feature のスケッチ、何でも構いません。

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
