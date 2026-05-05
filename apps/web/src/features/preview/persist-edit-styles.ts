// Edit 模式累积写回。
//
// 用户在 Edit 模式下点元素 → 改样式 → 内部 setStyle 在 iframe DOM 上即时生效；
// 离开 Edit 模式时把累积的改动按 outerHTML 锚点定位回源文件，写 inline style：
//   - .html / .htm：合并到 `style="..."` 属性
//   - .jsx / .tsx 及未知后缀：合并到 `style={{ ... }}` 对象字面量
//
// P2-12 — JSX/TSX path now goes through `findSourceMatch` (AST-based) so
// `React.createElement('button', {...})` and prop-order-skewed JSX literals
// also resolve. Legacy `source.includes(opening)` is kept ONLY for HTML files
// (where AST parsing isn't applicable) and as a last-ditch fallback.

import type { CallExpression, JSXOpeningElement, ObjectExpression } from '@babel/types';

import { api } from '@/lib/api';
import {
  createElementPropsObject,
  findObjectProperty,
  findSourceMatch,
} from './persist-edit-utils';

export interface PendingEditEntry {
  /** Selector from ELEMENT_SELECTED.selector — for debugging only. */
  selector: string;
  /** Original outerHTML (≤ 600 bytes) used as the anchor for source lookup. */
  outerHTMLSnippet: string;
  /** Accumulated CSS prop → value map (kebab-case keys, raw value strings). */
  styles: Record<string, string>;
}

// ───────── opening-tag extraction ─────────

const OPENING_TAG_RE = /^<[a-zA-Z][^<]*?>/;

function extractOpeningTag(snippet: string): string {
  const m = snippet.match(OPENING_TAG_RE);
  return m ? m[0] : snippet;
}

function kebabToCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ───────── HTML branch ─────────

const HTML_STYLE_RE = /\sstyle\s*=\s*(["'])([^"']*)\1/;

function parseHtmlDecls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(';')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx).trim();
    const val = part.slice(colonIdx + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function stringifyHtmlDecls(decls: Record<string, string>): string {
  return Object.entries(decls)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

function applyInlineStyleHtml(
  source: string,
  snippet: string,
  styles: Record<string, string>,
): string {
  const opening = extractOpeningTag(snippet);
  if (!source.includes(opening)) return source;

  const m = HTML_STYLE_RE.exec(opening);
  let nextOpening: string;
  if (m) {
    const merged = { ...parseHtmlDecls(m[2]!), ...styles };
    nextOpening = opening.replace(HTML_STYLE_RE, ` style="${stringifyHtmlDecls(merged)}"`);
  } else {
    nextOpening = opening.replace(/(\s*\/?>)$/, ` style="${stringifyHtmlDecls(styles)}"$1`);
  }
  if (nextOpening === opening) return source;
  return source.replace(opening, nextOpening);
}

// ───────── JSX branch ─────────

// Match `style={{ ... }}` — `[^}]*` keeps it simple; nested braces inside style
// values (e.g. `style={{ x: foo() }}`) would break this, but MVP source comes
// from agent-generated artifacts that use literal string values.
const JSX_STYLE_RE = /\sstyle\s*=\s*\{\{([^}]*)\}\}/;

function parseJsxStyleObject(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(',')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx).trim();
    let val = part.slice(colonIdx + 1).trim();
    // strip surrounding single or double quotes
    val = val.replace(/^["']|["']$/g, '');
    if (key) out[key] = val;
  }
  return out;
}

function stringifyJsxStyleObject(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: "${v}"`)
    .join(', ');
}

function applyInlineStyleJsx(
  source: string,
  snippet: string,
  styles: Record<string, string>,
): string {
  const camelStyles: Record<string, string> = {};
  for (const [k, v] of Object.entries(styles)) camelStyles[kebabToCamel(k)] = v;

  // AST path — handles JSX literals AND React.createElement, and is robust to
  // prop-order skew between `outerHTML` and JSX source.
  const match = findSourceMatch(source, snippet);
  if (match) {
    if (match.kind === 'jsx-opening') {
      return mutateJsxOpeningStyle(source, match.node as JSXOpeningElement, camelStyles);
    }
    return mutateCreateElementStyle(source, match.node as CallExpression, camelStyles);
  }

  // Fallback: legacy literal-substring path (e.g. when source isn't parseable
  // but the rendered tag string still appears verbatim — defensive only).
  const opening = extractOpeningTag(snippet);
  if (!source.includes(opening)) return source;
  const m = JSX_STYLE_RE.exec(opening);
  let nextOpening: string;
  if (m) {
    const merged = { ...parseJsxStyleObject(m[1]!), ...camelStyles };
    nextOpening = opening.replace(JSX_STYLE_RE, ` style={{ ${stringifyJsxStyleObject(merged)} }}`);
  } else {
    nextOpening = opening.replace(
      /(\s*\/?>)$/,
      ` style={{ ${stringifyJsxStyleObject(camelStyles)} }}$1`,
    );
  }
  if (nextOpening === opening) return source;
  return source.replace(opening, nextOpening);
}

// ───────── JSX opening (AST-located) ─────────

function mutateJsxOpeningStyle(
  source: string,
  node: JSXOpeningElement,
  camelStyles: Record<string, string>,
): string {
  if (node.start == null || node.end == null) return source;
  // Find existing style={{ ... }} attribute.
  for (const attr of node.attributes) {
    if (attr.type !== 'JSXAttribute') continue;
    if (attr.name.type !== 'JSXIdentifier' || attr.name.name !== 'style') continue;
    const v = attr.value;
    if (
      v?.type === 'JSXExpressionContainer' &&
      v.expression.type === 'ObjectExpression' &&
      attr.start != null &&
      attr.end != null
    ) {
      const objNode = v.expression;
      if (objNode.start == null || objNode.end == null) return source;
      // Merge: read current literal-string entries; later wins on collision.
      const existing = readLiteralStringObject(objNode, source);
      const merged = { ...existing, ...camelStyles };
      const newObj = `{ ${stringifyJsxStyleObject(merged)} }`;
      return source.slice(0, objNode.start) + newObj + source.slice(objNode.end);
    }
    // style={someVar} or other expression — leave alone (don't corrupt).
    return source;
  }
  // No existing style attr — inject ` style={{ ... }}` before the closing >.
  const opening = source.slice(node.start, node.end);
  const replaced = opening.replace(
    /(\s*\/?>)$/,
    ` style={{ ${stringifyJsxStyleObject(camelStyles)} }}$1`,
  );
  if (replaced === opening) return source;
  return source.slice(0, node.start) + replaced + source.slice(node.end);
}

// ───────── createElement (AST-located) ─────────

/** Parse an ObjectExpression's literal-string-valued properties into a flat record. */
function readLiteralStringObject(obj: ObjectExpression, source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prop of obj.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    if (prop.computed) continue;
    let key: string | null = null;
    if (prop.key.type === 'Identifier') key = prop.key.name;
    else if (prop.key.type === 'StringLiteral') key = prop.key.value;
    if (!key) continue;
    if (prop.value.type === 'StringLiteral') {
      out[key] = prop.value.value;
    } else if (
      prop.value.type === 'NumericLiteral' ||
      prop.value.type === 'BigIntLiteral' ||
      prop.value.type === 'BooleanLiteral'
    ) {
      // Stringify primitives we can read back accurately. Discard others
      // (template literals with expressions, calls, etc.) to avoid corruption.
      out[key] = String(prop.value.value);
    } else if (prop.value.start != null && prop.value.end != null) {
      // Skip non-trivial values — re-emitting them would change semantics.
      // We deliberately drop them from the merged record so the merge is
      // additive (caller's new keys win). Callers should not rely on style
      // mutation preserving complex existing values; this is V1 territory.
      void source;
    }
  }
  return out;
}

function mutateCreateElementStyle(
  source: string,
  call: CallExpression,
  camelStyles: Record<string, string>,
): string {
  const props = createElementPropsObject(call);
  if (!props) {
    // Synthesize a props arg if the call has no props or has `null`/`undefined`.
    return injectCreateElementProps(source, call, camelStyles);
  }
  if (props.start == null || props.end == null) return source;

  const styleProp = findObjectProperty(props, 'style');
  if (!styleProp) {
    // No `style:` key yet — insert one.
    const styleText = `style: { ${stringifyJsxStyleObject(camelStyles)} }`;
    return insertPropertyIntoObject(source, props, styleText);
  }
  // Existing `style:` — only support an inline ObjectExpression.
  if (styleProp.value.type !== 'ObjectExpression') return source;
  const styleObj = styleProp.value;
  if (styleObj.start == null || styleObj.end == null) return source;
  const existing = readLiteralStringObject(styleObj, source);
  const merged = { ...existing, ...camelStyles };
  const newObj = `{ ${stringifyJsxStyleObject(merged)} }`;
  return source.slice(0, styleObj.start) + newObj + source.slice(styleObj.end);
}

/** Insert `propText` (e.g. `style: { ... }`) into an ObjectExpression. */
function insertPropertyIntoObject(source: string, obj: ObjectExpression, propText: string): string {
  if (obj.start == null || obj.end == null) return source;
  // Empty object `{}` — replace with `{ propText }`.
  if (obj.properties.length === 0) {
    const replacement = `{ ${propText} }`;
    return source.slice(0, obj.start) + replacement + source.slice(obj.end);
  }
  // Non-empty object — append before the closing `}`. Walk back from end-1
  // through whitespace until we hit `}`; insert just before it with a comma.
  // Locate the closing `}` byte. The end position is exclusive of `}`+1, so
  // the closing brace is at obj.end - 1.
  const closeIdx = obj.end - 1;
  if (source[closeIdx] !== '}') return source;
  // Trim trailing whitespace/comma between last prop and `}` for clean output.
  let insertAt = closeIdx;
  // Walk back over whitespace.
  while (insertAt > obj.start + 1 && /\s/.test(source[insertAt - 1] ?? '')) insertAt -= 1;
  const needsComma = source[insertAt - 1] !== ',' && source[insertAt - 1] !== '{';
  const chunk = (needsComma ? ', ' : ' ') + propText + ' ';
  return source.slice(0, insertAt) + chunk + source.slice(insertAt);
}

/** Add a props object as the 2nd arg of `createElement(tag, ?, ?…)`. */
function injectCreateElementProps(
  source: string,
  call: CallExpression,
  camelStyles: Record<string, string>,
): string {
  // Insert after the first argument (the tag string). If there are 0 args this
  // shouldn't be reachable (we only collect calls with a string-literal tag).
  const arg0 = call.arguments[0];
  if (!arg0 || arg0.start == null || arg0.end == null) return source;
  const propsText = `{ style: { ${stringifyJsxStyleObject(camelStyles)} } }`;

  const arg1 = call.arguments[1];
  if (!arg1) {
    // Just `createElement(tag)` — append `, {…}`.
    const insertAt = arg0.end;
    return source.slice(0, insertAt) + `, ${propsText}` + source.slice(insertAt);
  }
  // `createElement(tag, null, …)` or with a non-object props arg (defensive).
  if (arg1.type === 'NullLiteral' || (arg1.type === 'Identifier' && arg1.name === 'undefined')) {
    if (arg1.start == null || arg1.end == null) return source;
    return source.slice(0, arg1.start) + propsText + source.slice(arg1.end);
  }
  // Non-object expression as props (e.g. variable spread) — leave alone.
  return source;
}

// ───────── public API ─────────

export function applyInlineStyleToSource(
  source: string,
  filePath: string,
  snippet: string,
  styles: Record<string, string>,
): string {
  if (Object.keys(styles).length === 0) return source;
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return applyInlineStyleHtml(source, snippet, styles);
  }
  return applyInlineStyleJsx(source, snippet, styles);
}

export function mergePendingEdit(
  map: Map<string, PendingEditEntry>,
  selector: string,
  outerHTML: string,
  property: string,
  value: string,
): Map<string, PendingEditEntry> {
  const next = new Map(map);
  const existing = next.get(selector);
  if (existing) {
    next.set(selector, {
      ...existing,
      styles: { ...existing.styles, [property]: value },
    });
  } else {
    next.set(selector, {
      selector,
      outerHTMLSnippet: outerHTML,
      styles: { [property]: value },
    });
  }
  return next;
}

// ───────── persistence ─────────

export interface PersistFile {
  path: string;
  content: string;
}

export interface PersistResult {
  written: number;
  missed: number;
}

/**
 * Find the source file that hosts the snippet — AST-aware, with a literal
 * substring fallback for HTML files / unparseable sources.
 */
function findTargetFile(files: readonly PersistFile[], snippet: string): PersistFile | undefined {
  // First pass — AST-based match for JSX-bearing files.
  for (const f of files) {
    const lower = f.path.toLowerCase();
    if (
      lower.endsWith('.jsx') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.js') ||
      lower.endsWith('.ts')
    ) {
      const m = findSourceMatch(f.content, snippet);
      if (m) return f;
    }
  }
  // Fallback — literal opening-tag substring (HTML files; defensive net).
  const opening = extractOpeningTag(snippet);
  return files.find((f) => f.content.includes(opening));
}

/**
 * Walk pending edits, mutate matching source files, PUT back to the API.
 *
 * "Missed" = no source file's content contained the snippet's opening tag.
 * Caller can surface this via toast; UI keeps the optimistic DOM change.
 *
 * Uses keepalive PUT so requests survive an unmount that lands between the
 * tool change and the response (mirrors persistEditModeKeys on Tweaks side).
 */
export async function persistEditStyles(
  projectId: string,
  files: readonly PersistFile[],
  pending: Map<string, PendingEditEntry>,
): Promise<PersistResult> {
  let written = 0;
  let missed = 0;

  await Promise.all(
    Array.from(pending.values()).map(async (entry) => {
      const target = findTargetFile(files, entry.outerHTMLSnippet);
      if (!target) {
        missed++;
        return;
      }
      const next = applyInlineStyleToSource(
        target.content,
        target.path,
        entry.outerHTMLSnippet,
        entry.styles,
      );
      if (next === target.content) return;
      try {
        await api(
          `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(target.path)}`,
          {
            method: 'PUT',
            body: { path: target.path, content: next } as unknown as BodyInit,
            keepalive: true,
          },
        );
        written++;
      } catch (err) {
        console.warn('[edit] failed to persist style', target.path, err);
        missed++;
      }
    }),
  );

  return { written, missed };
}
