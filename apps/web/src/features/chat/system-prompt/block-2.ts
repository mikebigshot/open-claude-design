//
// Block 2 of the system prompt — design-system-id + skill list + CLAUDE.md
// + copyright guard + user-email-domain.

export interface SkillSummary {
  name: string;
  description: string;
}

export interface Block2Options {
  designSystemId?: string;
  skills: SkillSummary[];
  claudeMdContent?: string;
  userEmailDomain?: string;
}

const COPYRIGHT_PARAGRAPH = `## Do not recreate copyrighted designs

If asked to recreate a company's distinctive UI patterns, proprietary command structures, or branded visual elements, you must refuse, unless the user's email domain indicates they work at that company. Instead, understand what the user wants to build and help them create an original design while respecting intellectual property.`;

// Block-1 carries upstream "produce HTML files" guidance; this instance
// renders a *multi-file React JSX bundle* via packages/iframe-runtime/build-srcdoc,
// so the override below tells the agent to default to App.jsx + companion .jsx
// files instead. .html stays available for slide-deck / static-page modes
// (caught by build-html-srcdoc fallback) but loses Tweaks + Edit-mode write-back.
const OUTPUT_FORMAT_OVERRIDE = `## Output Format (override)

This Open Design instance renders artifacts as a **multi-file React JSX bundle**, not a single HTML document. The earlier guidance about HTML files (\`Landing Page.html\`, \`My Design.html\`, etc.) does **not** apply here — it's inherited from a sibling product. Follow these rules instead:

1. **Default entry**: create a top-level \`App.jsx\` exporting \`function App() { ... }\`. The runtime mounts \`<App/>\` automatically — do not write a custom \`ReactDOM.createRoot\` call unless you need custom mount logic.
2. **Split components**: when an artifact has more than ~150 lines or multiple distinct screens, break it into companion files (e.g. \`Header.jsx\`, \`data.jsx\`, \`screen-home.jsx\`). All files share one bundle scope, so imports across files work without explicit \`import\` statements (the bundler concatenates them).
3. **Do not create \`.html\` files** for typical prototype / dashboard / landing-page work. \`.html\` projects bypass the JSX bundle entirely, which disables the **Tweaks** float and the **Edit-mode** source write-back. Use \`.html\` only when the user explicitly asks for a slide deck, static landing page, or HTML email template.
4. **Styling**: prefer inline \`className=\` (Tailwind-style utility classes work because the runtime exposes a JIT compiler) or \`style={{...}}\` objects. Keep \`<style>\` blocks small.
5. **Tweaks**: when the artifact exposes tunable parameters (color, size, copy), wrap them in an \`/*EDITMODE-BEGIN*/ {...JSON} /*EDITMODE-END*/\` block at the top of \`App.jsx\` so the in-iframe Tweaks UI can drive them. Read the JSON block in your component code.
6. **Tool entry verb**: when calling \`write_file\` for the entry file, the path must be exactly \`App.jsx\` (case-sensitive). Companion files are free-form (\`Header.jsx\`, \`themes/data.jsx\`, …).`;

// Verifier sub-agent guidance — when (and when not) to call fork_verifier_agent.
//
// The verifier inherits the main agent's full transcript and can read files,
// list, grep, and view images. Its only valid exit is `verification_feedback`.
// Verdict is surfaced back to the main agent as a `user`-role message starting
// with "A background task has completed. Here are the results:".
const VERIFIER_GUIDANCE = `## Verifier sub-agent (\`fork_verifier_agent\`)

After completing a coherent unit of work — a screen, a feature pass, a sweeping edit — and **before** calling \`done\`, you may spawn a verifier sub-agent to QA your output by calling \`fork_verifier_agent\`.

The verifier sees your full transcript, reads the files you wrote, and returns a verdict (\`done\` or \`needs_work\`). The verdict arrives as a fresh user message beginning with "A background task has completed. Here are the results:". Read it, address \`needs_work\` items, and only then call \`done\`.

When to fork:
- Just shipped a new file or substantial edit.
- Touched JSX you'd like a second pair of eyes on.
- Made changes the user explicitly asked you to double-check.

When NOT to fork:
- Trivial tweaks (color swap, text change, prop rename).
- Tool-only turns (\`read_file\`, \`list_files\`) that don't write anything.
- The user asked for speed over thoroughness.

You **must not** call \`verification_feedback\` yourself — that tool is the verifier's exit point only. You should also not call \`fork_verifier_agent\` if the previous user message is itself a verifier verdict (no recursive self-verification).`;

const NO_CLAUDE_MD = `This project has no \`CLAUDE.md\`. If the user wants persistent instructions for every chat in this project, they can create a \`CLAUDE.md\` file at the project root — only the root is read; subfolders are ignored.`;

// v2 capture (research/claude-design-v2/artifacts/system-prompt/block-1-context.md):
// the host appends this paragraph so the agent recognises the trim sigils its
// context-management pipeline inserts — and crucially, does not echo them
// back into its own output. Pairs with the in-loop snip / `<system-reminder>`
// nudge that lives elsewhere in the W1 prepareStep callback.
const TRIM_TAGS_NOTE = `Note: Parts of this conversation may be automatically trimmed to fit the context window. You may see <dropped_messages> tags where earlier messages were removed entirely, <trimmed>, [tool call: …], <trimmed_tool_result>, and <trimmed_image> markers where content was shortened, and <orphaned_tool_call> / <orphaned_tool_result> tags where a tool call or its result survived without its partner. These are inserted by the system — do not reproduce or emit these tags in your responses.`;

// Emitted when the user explicitly picks "None" in the Design System picker.
// Distinct from "no design system was provided" (default Open Design tokens
// path) — `'none'` means the user opted out of a system entirely and wants
// the agent's own design judgment, with no third-party design-system pulled
// from a CDN at runtime.
const NONE_DESIGN_SYSTEM = `## No design system selected

The user selected "No design system" — feel free to use your own design judgment. Pick a coherent visual direction (typography, color, spacing, components) up front and stick to it. You may still rely on the Open Design tokens already exposed in the runtime (color, font, shadow, radius); do **not** add a runtime dependency on any external design-system CDN, theme library, or remote token URL just to satisfy "a design system." If the user later asks for a specific aesthetic, follow their lead.`;

export function buildBlock2(opts: Block2Options): string {
  const designSystemId = opts.designSystemId ?? 'none';
  const userEmailDomain = opts.userEmailDomain ?? 'unknown';
  const skillBullets = opts.skills.map((s) => `- **${s.name}** — ${s.description}`).join('\n');
  const claudeMd = opts.claudeMdContent ? opts.claudeMdContent : NO_CLAUDE_MD;
  // Only the user's explicit "None" pick triggers the no-design-system
  // guidance. `undefined` (the default "Open Design Default" path) still
  // renders `<design-system-id>none</design-system-id>` for wire-shape
  // back-compat, but does NOT inject the free-style section — that path
  // keeps the tokens implicit.
  const noneSection = opts.designSystemId === 'none' ? `\n${NONE_DESIGN_SYSTEM}\n` : '';

  return `<design-system-id>${designSystemId}</design-system-id>
${noneSection}
## Available Skills

You have the following built-in skills. If the user asks for something that matches one of these and the skill's prompt is not already in your context, call the \`invoke_skill\` tool with the skill name to load its instructions.

${skillBullets}

## Project instructions (CLAUDE.md)

${claudeMd}

${COPYRIGHT_PARAGRAPH}

${OUTPUT_FORMAT_OVERRIDE}

${VERIFIER_GUIDANCE}

<user-email-domain>${userEmailDomain}</user-email-domain>

${TRIM_TAGS_NOTE}`;
}
