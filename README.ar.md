# Open Claude Design

> **إعادة بناء مفتوحة المصدر لـ [Claude Design](https://claude.ai/design) كتطبيق ويب خالص.** ورشة عمل لتصميم النماذج الأولية تعتمد على chat، تُولّد مشاريع React متعددة الملفات، مع أربع أدوات معاينة فورية: **Tweaks · Comment · Edit · Draw**. يعمل agent داخل tab المتصفح لديك؛ ويتولى Cloudflare Worker واحد (D1 + R2) تخزين الملفات. لا Electron، لا daemon محلي، لا وسيط LLM على الخادم.

<p align="center">
  <a href="https://github.com/imsai-sh/open-claude-design/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ffd700&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=2ecc71&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/issues"><img alt="Issues" src="https://img.shields.io/github/issues/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=ff6b6b&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/pulls"><img alt="Pull Requests" src="https://img.shields.io/github/issues-pr/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=9b59b6&logo=github&logoColor=white" /></a>
  <a href="https://github.com/imsai-sh/open-claude-design/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/imsai-sh/open-claude-design?style=for-the-badge&labelColor=0d1117&color=8e44ad&logo=git&logoColor=white" /></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" /></a>
  <img alt="Status" src="https://img.shields.io/badge/الحالة-pre--alpha-orange?style=flat-square" />
  <img alt="Stack" src="https://img.shields.io/badge/التقنيات-Vite%20%C2%B7%20React%2018%20%C2%B7%20Hono%20%C2%B7%20Cloudflare-black?style=flat-square" />
  <a href="#التطوير-المحلي"><img alt="التطوير المحلي" src="https://img.shields.io/badge/التطوير%20المحلي-الصق%20كتلة-green?style=flat-square" /></a>
  <a href="#الاستضافة-الذاتية-على-cloudflare"><img alt="الاستضافة الذاتية" src="https://img.shields.io/badge/الاستضافة%20الذاتية-الصق%20كتلة-blueviolet?style=flat-square" /></a>
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es-ES.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a> · <b>العربية</b></p>

<p align="center">بقلم <a href="https://www.imsai.cc/">imsai</a></p>

---

<div dir="rtl">

> ⚠️ **الحالة: pre-alpha.** البنية المعمارية مستقرة، والأدوات الأربع للمعاينة تعمل من البداية إلى النهاية، لكن يمكن أن تظهر breaking changes في أي release. إن كنت تعتمد على حرفية wire format، فثبّت commit معيّناً.

## لماذا هذا المشروع موجود

حوّل [Claude Design](https://claude.ai/design) من Anthropic نموذج LLM إلى أداة تُسلّم artifacts تصميم تفاعلية: chat من جهة، نموذج React أولي متعدد الملفات من الجهة الأخرى، تعديل أي عنصر مباشرة، ثم ship. انتشر بسرعة، وبقي **مغلق المصدر**، مدفوعاً، يعمل في السحابة فقط، ومقيداً بـ stack الخاص بـ Anthropic.

**Open Claude Design هو إعادة بناء أمينة مفتوحة المصدر لتلك الواجهة، بنفس الهيكل التقني.** في كل نقطة تتطلب اختياراً، آثرنا ما أصدرته Anthropic فعلياً — صيغة artifact، كتلة `EDITMODE` الخاصة بـ Tweaks، اصطلاح تسمية sub-agent بصيغة `<uuid>::verifier`، مسار المعاينة عبر Babel Standalone داخل iframe، وقواعد `postMessage` للأدوات الأربع (`SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY` / `IFRAME_ERROR` / …). أكبر مدخل وحيد لهذا الـ codebase هو قراءة ما نشرته Anthropic.

نختلف عن Claude Design في اتجاه واحد: **ويب خالص، بلا غلاف، بلا SaaS.** يعمل المنتج بأكمله داخل tab متصفح + Cloudflare Worker واحد. يُنفَّذ chat agent (tool-loop من [Vercel AI SDK](https://github.com/vercel/ai)) **داخل tab الخاص بك** ويتصل بـ OpenRouter مباشرة باستخدام key الخاص بك — ودور Worker قاصر على التخزين، فهو لا يرى prompts الخاصة بك أبداً. هذه المقايضة تشتري ثلاثة أشياء:

1. **deploy بأمر واحد على حساب Cloudflare مجاني** — لا Postgres، لا Redis، لا ECS، لا Docker.
2. **لا حسابات، لا SaaS مشترك، لا حصص** — fork له، deploy له، أرسل الرابط لأصدقائك.
3. **codebase يمكن قراءته كاملاً** — TS صارم، npm workspaces، نحو 10 مجلدات مصدرية. الأجزاء الممتعة (iframe runtime، بروتوكول `EDITMODE`، حلقة agent على المتصفح) يمكن قراءتها في عطلة نهاية أسبوع.

## شكر وتقدير

يقوم هذا المشروع على عمل كثير من الناس.

**[Claude Design من Anthropic](https://claude.ai/design)** هو المنتج الذي يعيد Open Claude Design بناءه. نحمل احتراماً هائلاً لما بناه الفريق الأصلي وللمعيار الذي وضعه — كل طبقة من التجربة تعكس مدى اهتمامهم. هذا الـ codebase هو رحلة الارتقاء إلى ذلك المعيار.

نريد أيضاً أن نشكر مشروعَين آخرين مفتوحَي المصدر في هذا الاتجاه:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — على ما بذلوه من هندسة مفتوحة المصدر متينة ومدروسة بعناية في هذا الاتجاه.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — على نشرهم العلني لرؤيتهم الخاصة لنفس المشكلة.

كلاهما أثرى النقاش المفتوح المصدر حول هذا المنتج، ونحن ممتنون لوجودهما.

### أدوات العمل

- [Vercel AI SDK](https://github.com/vercel/ai) — تجريد متعدد الـ providers يسمح بتشغيل حلقة agent داخل tab المتصفح.
- [OpenRouter](https://openrouter.ai/) — BYOK key واحد أمام عشرات من LLM providers.
- [React](https://react.dev/) و[Babel](https://babeljs.io/) — UMD builds تُشغّل runtime المعاينة داخل iframe.
- [Cloudflare Workers](https://workers.cloudflare.com/) و[D1](https://developers.cloudflare.com/d1/) و[R2](https://developers.cloudflare.com/r2/) — backend بلا خادم لتشغيله.
- [Hono](https://hono.dev/) و[Vite](https://vitejs.dev/) و[Turbo](https://turbo.build/)، إضافة إلى منظومة TypeScript / npm-workspaces الأوسع.

## إخلاء مسؤولية

Open Claude Design هو مشروع مفتوح المصدر يُعيد بناء المنتج بمبادرة مجتمعية. **هذا المشروع غير منتسب إلى Anthropic ولا مدعوم منها ولا برعايتها.** كلمتا "Claude" و "Claude Design" علامتان تجاريتان لشركة Anthropic, PBC.

بعض إرشادات سلوك agent — تحديداً محتوى system prompt الموجود تحت [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — مقتبس من ملاحظات على runtime العلني الخاص بـ Claude Design من Anthropic. نحتفظ بهذا المحتوى استناداً إلى مبرر fair use / قابلية التشغيل البيني، لإبقاء إعادة البناء مفتوحة المصدر قريبة قدر الإمكان من السطح الأصلي.

**إذا أراد أحد من Anthropic أن نزيل أو نُعيد صياغة أي محتوى، فسننفذ ذلك على الفور** — يُرجى فتح issue على [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) أو التواصل مع مشرف المستودع.

## نظرة سريعة

| | ما تحصل عليه |
|---|---|
| **الشكل** | ويب خالص — Vite SPA + Cloudflare Worker واحد. لا Electron، لا daemon محلي، لا تثبيت أصلي. |
| **AI runtime** | يعمل `ToolLoopAgent` من Vercel AI SDK **داخل tab المتصفح**. تستدعي الأدوات (`edit_file` / `read_file` / `list_files` / `mark_done`) REST API الخاصة بـ Worker لحفظ الملفات؛ لا يرى Worker prompts ولا keys أبداً. |
| **الـ Providers** | OpenRouter هو fan-out الافتراضي (key واحد → Anthropic، OpenAI، Google، Mistral، xAI، DeepSeek، Groq، Cerebras، …). كما أن SDKs المباشرة للـ providers موصولة: `@ai-sdk/{anthropic,openai,google,mistral,xai,deepseek,groq,cerebras,cohere,vercel}` بالإضافة إلى أي endpoint متوافق مع OpenAI. تعيش الـ keys في `localStorage`. |
| **التخزين** | Cloudflare **D1** (SQLite) للبيانات الوصفية + **R2** لـ blobs ملفات معنونة بالمحتوى عبر sha256. يربط Worker واحد كليهما. الفئة المجانية تكفي لكثير من المشاريع الفردية. |
| **سطح المعاينة** | iframe معزول يُشغّل React 18.3.1 + ReactDOM + `@babel/standalone` 7.29.0 — يُجمَّع من `srcdoc` نصي خالص. لا تسريب لـ React/npm runtime داخل المعاينة. يمكن vendor لـ UMD bundles لـ deploys بدون اتصال / بـ CSP صارم. |
| **Tweaks** | تُصدر artifacts كتلة `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` تُعرّف design tokens قابلة للضبط. تكشف واجهة المضيف sliders / pickers؛ وتعود التغييرات عبر أحداث `EDIT_STYLE` `postMessage` بدون إعادة تشغيل النموذج. |
| **Comment** | ضع pins في أي مكان على المعاينة الحية، اكتب تعليقاً، أرسل سياق الـ pin إلى agent لإعادة كتابة محددة الهدف. |
| **Edit** | انقر على أي عنصر DOM — يطفو inspector، تعدّل أنماط inline أو فئات Tailwind، وتُحفظ التغييرات في ملفات المشروع. |
| **Draw** | ارسم على المعاينة بأداة قلم؛ تُرسل الخطوط مع لقطة شاشة إلى النموذج لإعادة الكتابة بناءً على إشارتك المرسومة يدوياً. |
| **Wire** | HTTP REST + Server-Sent Events. مصدر وحيد للحقيقة في [`packages/contracts`](packages/contracts/) — كل نوع SSE event، كل نوع postMessage، وكل route shape هو حرفية هناك. |
| **License** | Apache-2.0 |

## ما الذي يفعله

- **Chat ← توليد** نموذج React أولي متعدد الملفات، يُبَث token-by-token إلى workspace المشروع.
- **Tweaks**: تتحول design tokens المعرّفة في artifact إلى sliders / colour pickers حيّة — اضبطها في مكانها، بلا إعادة prompt.
- **Comment**: ثبّت تعليقات على إحداثيات على المعاينة؛ أرسل سياق الـ pin إلى agent لإعادة كتابة محددة الهدف.
- **Edit**: انقر على أي عنصر، عدّل أنماط inline أو فئات Tailwind في inspector عائم، واحفظها في الملفات المصدرية.
- **Draw**: ارسم باليد على المعاينة؛ تنتقل الخطوط مع لقطة شاشة إلى الجولة التالية ليتمكن النموذج من التصرف وفق إشارتك.
- **مشاريع متعددة الملفات** (`.jsx` / `.html` / `.css`) تُعرض عبر Babel Standalone في iframe معزول — يُحلّ ملف entry بأولوية `.html`، ثم `.jsx`/`.tsx`.
- **قابل للاستيراد** — أسقط ZIP مُصدَّراً من Claude Design على workspace وتابع التحرير من حيث توقفت Anthropic.

## التقنيات

- **الواجهة الأمامية** — Vite + React 18.3.1 + React Router v6 + styled-components
- **الواجهة الخلفية** — [Hono](https://hono.dev/) على Cloudflare Workers
- **التخزين** — Cloudflare D1 (بيانات وصفية) + R2 (blobs معنونة بـ sha256)
- **AI** — `ToolLoopAgent` من [Vercel AI SDK](https://github.com/vercel/ai) يعمل داخل المتصفح، يستدعي OpenRouter أو أياً من 10 providers مباشرين باستخدام key المستخدم
- **Wire** — HTTP REST + SSE، schemas مثبتة في [`packages/contracts`](packages/contracts/)
- **الاختبارات** — Vitest (unit + integration) وPlaywright (e2e)

## التطوير المحلي

**المتطلبات المسبقة**: Node 22+، npm 10+. لا حاجة لحساب Cloudflare — يُشغّل `wrangler` D1 في وضع `--local` على ملف SQLite تحت `.wrangler/state/`.

انسخ هذه الكتلة كاملة والصقها في terminal جديد:

```bash
git clone https://github.com/imsai-sh/open-claude-design
cd open-claude-design
npm run setup    # نحو دقيقة في أول مرة: تثبيت deps + تطبيق D1 migrations
npm run dev      # web على :5173، api على :8787 (Ctrl-C للإيقاف)
```

عندما يعمل dev server، افتح <http://localhost:5173>. ستطلب منك أول رسالة chat لصق OpenRouter API key — احصل على واحد من [openrouter.ai/keys](https://openrouter.ai/keys) والصقه. يعيش الـ key فقط في `localStorage` لمتصفحك؛ امسحه أو غيّره في أي وقت من `/settings`.

في الجلسات اللاحقة، يكفي `npm run dev` — `setup` يُشغَّل مرة واحدة فقط.

> فحص سريع: `curl http://localhost:8787/health` ← `200 {"ok":true,...}`.

## الاستضافة الذاتية على Cloudflare

> أنت تُحضر حساب Cloudflare؛ ومستخدموك يُحضرون LLM key الخاص بهم. نحن لا نُشغّل SaaS مُستضافاً.

```bash
npm run cf:provision    # مرة واحدة: wrangler login + إنشاء D1 / R2 + تطبيق schema
npm run deploy          # كل مرة: ship لـ Worker (API) + Pages (SPA)
```

بعد انتهاء `npm run deploy` ستحصل على `https://open-design-web.pages.dev` (SPA) و`https://open-design-api.<your-subdomain>.workers.dev` (API).

ما الذي يفعله `cf:provision` دفعة واحدة: يسجّل دخولك إلى Cloudflare (يتجاوز إن كنت مسجلاً)، ينشئ قاعدة بيانات `open-design` D1 ويكتب `database_id` الخاصة بها في [`apps/api/wrangler.toml`](apps/api/wrangler.toml)، ينشئ R2 bucket باسم `open-design-blobs`، ويطبق D1 schema.

ما الذي يفعله `deploy`: يُنشر Worker، يجلب React + Babel UMD bundles عبر vendor إلى `apps/web/public/vendor/` كي تعمل المعاينات بدون اتصال / خلف firewalls / تحت CSP صارم، يبني SPA، ويُشحن إلى Cloudflare Pages (المشروع `open-design-web`).

أو تخطّ deploy اليدوي واستخدم GitHub Action المضمّن — push إلى `main` يُشغّل `.github/workflows/deploy.yml` بمجرد أن تضيف `CLOUDFLARE_API_TOKEN` و`CLOUDFLARE_ACCOUNT_ID` إلى secrets الخاصة بالـ repo. لا يفعل الـ workflow شيئاً بدونهما، لذا fork عادي آمن.

### نطاق مخصص

في لوحة تحكم Cloudflare، اربط نطاقاً مخصصاً بمشروع Pages (مثل `design.example.com`) وبـ Worker (مثل `api.design.example.com`). يتوقع SPA أن يصل `/api/*` إلى Worker — أعدّ Pages Function route أو إعادة كتابة عبر Cloudflare Routes UI لذلك المسار.

أضف origin الخاص بـ SPA إلى `ALLOWED_ORIGINS` ضمن `[vars]` في [`apps/api/wrangler.toml`](apps/api/wrangler.toml) (مفصولة بفواصل)، ثم أعد deploy لـ Worker — وإلا سيحجب CORS الطلبات.

## بنية المستودع

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

## المساهمة

مرحب بـ PRs. المشروع في مرحلة pre-alpha ومعيار المساهمة مرن — أصلح خطأً مطبعياً، أبلغ عن bug، أو ارسم feature.

```bash
npm install
npm run typecheck   # tsc --noEmit عبر workspace كاملاً
npm run lint        # eslint --max-warnings 0
npm test            # vitest
npm run test:e2e    # Playwright (يتطلب أن يكون `npm run dev` يعمل)
```

راجع [CONTRIBUTING.md](CONTRIBUTING.md) لإستراتيجية الفروع، اصطلاحات الـ commit، ومسار قراءة موجَّه عبر الـ codebase.

## License

[Apache License 2.0](LICENSE) — fork، عدّل، ship.

</div>
