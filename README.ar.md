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

**كما هو الحال في Claude Design، تبقى حلقة agent داخل tab المتصفح، بينما تتزامن chat / files / حالة المشروع مع backend خاص بك.** هذه أهم نقطة تطابق هيكلي مع الأصل — سحابة Anthropic ليست سوى وسيط LLM passthrough + تنفيذ tools + تخزين snapshots للمشروع، أما حلقة agent نفسها فتعمل داخل SPA المتصفح. نفعل الشيء نفسه: تعمل tool loop الخاصة بـ [Vercel AI SDK](https://github.com/vercel/ai) داخل tab الخاص بك، بينما تتدفق chat / files / حالة المشروع عبر Cloudflare Worker إلى D1 + R2، ولا يرى Worker أبداً prompts الخاصة بك. هذا الشكل **web-agent + backend-storage** هو بالضبط الشكل الذي يتدرّج بشكل طبيعي ليصبح SaaS.

## البنية المعمارية

> هذا القسم هو المواصفة الضمنية لهذا الـ codebase. نتائجه مستخلصة من تحقيق مسجَّل دخوله على `claude.ai/design` خلال 04-2026 — فحص DOM، التقاط الشبكة، قراءة المتغيرات العامة، تنزيل artifacts، فك تشفير runtime، وPOC شغّال. نلتزم قدر الإمكان بحقائق ملاحظة مباشرة.

### كيف يبدو Claude Design

نفس شكل Claude Code: المتصفح يستضيف agent، والسحابة مجرد بوابة LLM + backend للأدوات. جسم طلب Chat لجولة واحدة هو passthrough مباشر لـ Anthropic Messages API (system كامل + tools + جميع الرسائل، مُجمَّع من جانب العميل). خدمة `OmeletteService` السحابية **لا تحفظ حالة المحادثة** — هي فقط تُمرر الطلبات إلى LLM، تُنفّذ tools، وتُخزّن snapshots للمشروع.

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

#### الملاحظات الرئيسية

| البُعد | ما يعمل فعلياً |
|---|---|
| الواجهة الأمامية للتطبيق الرئيسي | Vite + React Router v6 + styled-components؛ محرر الكود `<textarea>` أصلي مع أرقام الأسطر بـ `<div>` يدوية — لا Monaco، لا CodeMirror |
| بروتوكول backend | Connect / gRPC-Web + Protobuf؛ اسم الخدمة `anthropic.omelette.api.v1alpha.OmeletteService` |
| بروتوكول tools agent | MCP (Model Context Protocol) — تم التقاط حمولة `tools/list` كاملة بحقل `defer_loading`؛ خوادم MCP خارجية تتصل فعلاً |
| توجيه tools | 30+ أداة موزعة على 9 buckets: cloud RPC (EditFile / GetFile / …) / local FSA (local_*) / iframe DOM (show_html / eval_js / screenshot) / منطق client خالص (snip / update_todos) / sub-agent مُولَّد / MCP خارجي / LLM-built-in (web_search / web_fetch) |
| Verifier sub-agent | يشارك agent الرئيسي **system prompt + toolset + history**؛ كل ما يفعله fork هو حقن prompt إعادة تعيين الدور في tool_result الخاص بـ fork + إضافة لاحقة `::verifier` على sessionUUID + تنصيف max_tokens |
| Preview iframe | كل مشروع على subdomain خاص به `{project-uuid}.claudeusercontent.com`؛ الموقع الرئيسي يُعيّن CSP `default-src 'none'; frame-ancestors 'none'`؛ preview tokens بأربعة أجزاء: `{file_content_hash}.{org_uuid}.{user_uuid}.{timestamp}` |
| runtime لـ artifact المُولَّد | React **18.3.1** + Babel Standalone **7.29.0** (UMD، integrity-hash مثبت) + كائنات JS `style={{...}}` inline + Google Fonts + multi-JSX `<script type="text/babel" src="*.jsx">` تُركَّب على window العام |
| بروتوكول Tweaks | تتضمن artifacts كتل `/*EDITMODE-BEGIN*/{JSON}/*EDITMODE-END*/` + postMessage `EDIT_STYLE` للكتابة العكسية الحية، بدون إعادة تشغيل النموذج |
| تخزين بسلطة العميل | يحتفظ المتصفح بـ chats / messages / contentBlocks / tool I/O / viewState / assets manifest الكاملة، ويرسل snapshot كاملاً عبر `UpdateProjectData`. **يُحفظ input/output لكل tool call** |
| العملية المركّبة `done` | تطلق سلسلة EditFile + RecordAsset + GetFile + ListFiles + UpdateProjectData |
| البث (Streaming) | ليس Anthropic SSE الأصلي — تُعيد OmeletteService تغليفه كإطارات مخصصة: `text_block` / `tool_delta` / `tool_block_complete` / `done` / `tokens` / `ratelimit_headers` |
| جسر المجلد المحلي | File System Access API + 4 أدوات `local_*` (local_ls / local_read / local_grep / local_copy_to_project)؛ الملفات المحلية **لا تصل أبداً** إلى OmeletteService — تظهر فقط في سياق LLM |

### كيف يبدو Open Claude Design

نحمل الرسم نفسه حرفياً: حلقة agent في المتصفح، السحابة للتخزين فقط. الشكل العام متطابق مع الأصل؛ نُبسّط فقط على مستوى المقايضات الهندسية (HTTP REST بدلاً من Connect / gRPC-Web، Cloudflare Worker بدلاً من backend مخصص، BYOK بدلاً من keys مُستضافة).

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

#### ما نحافظ عليه من الأصل

- **حلقة agent على جانب المتصفح** — يعمل `ToolLoopAgent` من Vercel AI SDK داخل tab (إطار agent الأصلي ليس متاحاً للعموم، لكن المضيف هو نفسه)
- **سلطة العميل + snapshot على backend** — D1 يحفظ بيانات المشروع الوصفية، R2 يحفظ blobs معنونة بالمحتوى عبر sha256، تُكتب على شكل snapshots كاملة
- **runtime لـ preview iframe** — React 18.3.1 + Babel Standalone 7.29.0، نفس الإصدارات و integrity hashes، مع الحفاظ على دلالات multi-JSX entry
- **حرفية البروتوكول** — `EDITMODE-BEGIN/END` لـ Tweaks، أنواع postMessage مثل `SET_MODE` / `EDIT_STYLE` / `ELEMENT_SELECTED` / `OVERLAY_READY`، اصطلاح تسمية sub-agent بصيغة `<uuid>::verifier` — كلها محفوظة حرفياً

#### حيث ننحرف بشكل متعمد

- **بروتوكول Wire** — مُبسَّط من Connect / gRPC-Web إلى HTTP REST + SSE (schemas في [`packages/contracts`](packages/contracts/)، بدون إعادة استخدام `.proto`)
- **الخطوط** — استُبدل خط Anthropic Serif التجاري بخطوط Google Fonts (Inter / Instrument Serif / JetBrains Mono)؛ الأيقونات عبر Lucide
- **Subdomain للمعاينة** — استُبدل `*.claudeusercontent.com` بـ subdomain الافتراضي لـ Cloudflare Pages (احضر نطاقك الخاص عند الاستضافة الذاتية)
- **جسر المجلد المحلي / MCP خارجي / verifier sub-agent** — لم يُنفَّذ بعد (roadmap)

## الفروق عن nexu-io/open-design و OpenCoworkAI/open-codesign

كل المشاريع الثلاثة هي إعادة بناء مفتوحة المصدر لـ Claude Design. الفرق الجوهري يدور حول **مكان عمل حلقة agent ومكان انتهاء chat / files**.

|  | Claude Design (الأصلي) | [open-codesign][ocod] | [nexu-io/open-design][nexu] | **Open Claude Design** |
|---|---|---|---|---|
| الشكل | Web (claude.ai) | Desktop (Electron) | تطبيق ويب + daemon محلي | **Web خالص + Cloudflare Workers** |
| أين تعمل حلقة agent | tab المتصفح | داخل عملية Electron الرئيسية، تُحزَّم مع [pi-ai] | الـ CLI الموجود لديك على القرص (Claude Code / Codex / Cursor / Gemini / … 13 محوّلاً) | **tab المتصفح (Vercel AI SDK ToolLoopAgent، BYOK)** |
| أين تعيش chat / files | السحابة (OmeletteService + blobs معنونة بالمحتوى) | SQLite محلي + نظام ملفات محلي | SQLite محلي + نظام ملفات محلي | **Cloudflare D1 + R2 (حسابك)** |
| تحتاج CLI / desktop shell محلياً؟ | لا | نعم (مُثبِّت Electron) | نعم (npm + أحد 13 CLI) | **لا — افتح الصفحة في متصفح** |
| التوافق الهيكلي مع الأصل | 100% | متوسط (agent على runtime مكتبي، ليس الويب) | متوسط (agent داخل CLI الخاص بالمستخدم، يُولَّد بواسطة daemon) | **عالٍ — agent في المتصفح + backend للتخزين، نفس شكل الأصل** |
| الترخيص | مغلق | MIT | Apache-2.0 | Apache-2.0 |

[ocod]: https://github.com/OpenCoworkAI/open-codesign
[nexu]: https://github.com/nexu-io/open-design
[pi-ai]: https://github.com/mariozechner/pi-ai

باختصار: **open-codesign و nexu-io محليّان أولاً (agent على الـ desktop أو داخل CLI المستخدم، الملفات على القرص)؛ نحن و Claude Design الأصلي ويبيّان أولاً (agent في المتصفح، الملفات في backend سحابي)**. لكلٍ مقايضاته — اخترنا الشكل الأكثر تطابقاً هيكلياً مع ما تُصدره Anthropic فعلياً.

## شكر وتقدير

يقوم هذا المشروع على عمل كثير من الناس.

**[Claude Design من Anthropic](https://claude.ai/design)** هو المنتج الذي يعيد Open Claude Design بناءه. نحمل احتراماً هائلاً لما بناه الفريق الأصلي وللمعيار الذي وضعه — كل طبقة من التجربة تعكس مدى اهتمامهم. هذا الـ codebase هو رحلة الارتقاء إلى ذلك المعيار.

نريد أيضاً أن نشكر مشروعَين آخرين مفتوحَي المصدر في هذا الاتجاه:

- [**nexu-io/open-design**](https://github.com/nexu-io/open-design) — على ما بذلوه من هندسة مفتوحة المصدر متينة ومدروسة بعناية في هذا الاتجاه.
- [**OpenCoworkAI/open-codesign**](https://github.com/OpenCoworkAI/open-codesign) — على نشرهم العلني لرؤيتهم الخاصة لنفس المشكلة.

كلاهما أثرى النقاش المفتوح المصدر حول هذا المنتج، ونحن ممتنون لوجودهما.

### أدوات العمل

- [Vercel AI SDK](https://github.com/vercel/ai) — تجريد متعدد الـ providers يسمح بتشغيل حلقة agent داخل tab المتصفح.
- [React](https://react.dev/) و[Babel](https://babeljs.io/) — UMD builds تُشغّل runtime المعاينة داخل iframe.
- [Cloudflare Workers](https://workers.cloudflare.com/) و[D1](https://developers.cloudflare.com/d1/) و[R2](https://developers.cloudflare.com/r2/) — backend بلا خادم لتشغيله.
- [Hono](https://hono.dev/) و[Vite](https://vitejs.dev/) و[Turbo](https://turbo.build/)، إضافة إلى منظومة TypeScript / npm-workspaces الأوسع.

## إخلاء مسؤولية

Open Claude Design هو مشروع مفتوح المصدر يُعيد بناء المنتج بمبادرة مجتمعية. **هذا المشروع غير منتسب إلى Anthropic ولا مدعوم منها ولا برعايتها.** كلمتا "Claude" و "Claude Design" علامتان تجاريتان لشركة Anthropic, PBC.

بعض إرشادات سلوك agent — تحديداً محتوى system prompt الموجود تحت [`apps/web/src/features/chat/system-prompt/`](apps/web/src/features/chat/system-prompt/) — مقتبس من ملاحظات على runtime العلني الخاص بـ Claude Design من Anthropic. نحتفظ بهذا المحتوى استناداً إلى مبرر fair use / قابلية التشغيل البيني، لإبقاء إعادة البناء مفتوحة المصدر قريبة قدر الإمكان من السطح الأصلي.

**إذا أراد أحد من Anthropic أن نزيل أو نُعيد صياغة أي محتوى، فسننفذ ذلك على الفور** — يُرجى فتح issue على [github.com/imsai-sh/open-claude-design/issues](https://github.com/imsai-sh/open-claude-design/issues) أو التواصل مع مشرف المستودع.

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

> أنت تُحضر حساب Cloudflare؛ ومستخدموك يُحضرون LLM key الخاص بهم.

```bash
npm run cf:provision    # مرة واحدة: wrangler login + إنشاء D1 / R2 + تطبيق schema
npm run deploy          # كل مرة: ship لـ Worker (API) + Pages (SPA)
```

بعد انتهاء `npm run deploy` ستحصل على `https://open-design-web.pages.dev` (SPA) و`https://open-design-api.<your-subdomain>.workers.dev` (API).

ما الذي يفعله `cf:provision` دفعة واحدة: يسجّل دخولك إلى Cloudflare (يتجاوز إن كنت مسجلاً)، ينشئ قاعدة بيانات `open-design` D1 ويكتب `database_id` الخاصة بها في [`apps/api/wrangler.toml`](apps/api/wrangler.toml)، ينشئ R2 bucket باسم `open-design-blobs`، ويطبق D1 schema.

ما الذي يفعله `deploy`: يُنشر Worker، يجلب React + Babel UMD bundles عبر vendor إلى `apps/web/public/vendor/` كي تعمل المعاينات بدون اتصال / خلف firewalls / تحت CSP صارم، يبني SPA، ويُشحن إلى Cloudflare Pages (المشروع `open-design-web`).

أو تخطّ deploy اليدوي واستخدم GitHub Action المضمّن — push إلى `main` يُشغّل `.github/workflows/deploy.yml` بمجرد أن تضيف `CLOUDFLARE_API_TOKEN` و`CLOUDFLARE_ACCOUNT_ID` إلى secrets الخاصة بالـ repo. لا يفعل الـ workflow شيئاً بدونهما، لذا fork عادي آمن.

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

مرحب بـ PRs. المشروع في مرحلة pre-alpha ومعيار المساهمة مرن.

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
