// Shared source-locator for Edit-mode write-back (P2-12).
//
// Both persist-edit-styles.ts and persist-edit-classnames.ts need to translate
// a runtime DOM snapshot (`outerHTML`, captured via ELEMENT_SELECTED in the
// iframe overlay) back to a position in the on-disk source file. The naive
// approach `source.includes(openingTag)` fails in two well-known ways:
//
//   1. **createElement-style code**: when the agent emits
//      `React.createElement("button", { className: "primary" }, "Click")`
//      instead of a JSX literal `<button className="primary">Click</button>`,
//      the rendered DOM is identical but no opening tag substring exists in
//      the source. The original outerHTML grep silently misses → user's edit
//      is reflected in the iframe (optimistic) but never lands on disk →
//      reload erases the change with zero feedback.
//
//   2. **JSX prop-order skew**: the runtime `outerHTML` orders attrs in DOM
//      order (often alphabetical), but the JSX source has them in author
//      order. `<button onClick={fn} className="primary">` and the rendered
//      `<button class="primary" onClick="...">` won't match as substrings.
//
// Strategy:
//   - Parse `tag` + `classList` from the snippet (cheap regex; both shapes
//     have the same DOM tag name and `class=` attr after React renders).
//   - AST-parse the source via @babel/parser (already in the deps for the
//     classname write-back). Walk the tree manually (no @babel/traverse —
//     see persist-edit-classnames.ts header for why).
//   - Score every JSXOpeningElement and every CallExpression of the form
//     `React.createElement("tag", { className: ... }, ...)` against the
//     snippet's (tag, classList). The best-scoring node wins.
//   - Return the byte range of the **opening tag** (or the props-object of
//     the createElement call) so callers can splice in style / className
//     mutations without reformatting the rest of the file.
//
// Limitation: createElement with a non-string-literal className (variable
// reference, cn(...) call, ternary) is reported as `unsupported`. The caller
// surfaces this via the toast pipeline so the user knows their edit didn't
// persist. Source files that mix React.createElement and dynamic class names
// are rare in agent-generated artifacts; the agent system prompt explicitly
// asks for JSX literals.

import { parse } from '@babel/parser';
import type {
  CallExpression,
  JSXOpeningElement,
  Node,
  ObjectExpression,
  ObjectProperty,
} from '@babel/types';

// ─────────────────────────────────────────────────────────────────────────────
// Snippet → (tag, classList) extraction
// ─────────────────────────────────────────────────────────────────────────────

const OPENING_TAG_RE = /^<([a-zA-Z][a-zA-Z0-9-]*)\b[^<>]*?>/;
const CLASS_ATTR_RE = /\s(?:class|className)\s*=\s*(["'])([^"']*)\1/;

export interface SnippetInfo {
  tag: string;
  classList: string[];
}

export function parseSnippet(snippet: string): SnippetInfo | null {
  const tagM = snippet.match(OPENING_TAG_RE);
  if (!tagM) return null;
  const tag = tagM[1]!.toLowerCase();
  const classM = snippet.match(CLASS_ATTR_RE);
  const classList = classM
    ? classM[2]!
        .split(/\s+/)
        .map((c) => c.trim())
        .filter(Boolean)
    : [];
  return { tag, classList };
}

// ─────────────────────────────────────────────────────────────────────────────
// AST scoring
// ─────────────────────────────────────────────────────────────────────────────

type SourceMatchKind = 'jsx-opening' | 'create-element';

export interface SourceMatch {
  kind: SourceMatchKind;
  /** Tag name as written in the source (lowercased for comparison purposes). */
  tag: string;
  /**
   * Byte range in source covering the OPENING TAG only:
   * - For `kind === 'jsx-opening'`: the JSXOpeningElement (`<button …>` or `<button …/>`).
   * - For `kind === 'create-element'`: the entire `React.createElement(…)` call expression.
   */
  start: number;
  end: number;
  /** AST node — typed loosely so callers can downcast as needed. */
  node: JSXOpeningElement | CallExpression;
  /**
   * Optional anchor used in tests/diagnostics — best-effort textual
   * representation of the matched element (e.g. the original opening tag or
   * a slice of the createElement call).
   */
  outerHTMLAnchor: string;
}

/** Keys we explicitly skip during the AST walk — see persist-edit-classnames.ts. */
const SKIP_KEYS = new Set([
  'loc',
  'tokens',
  'comments',
  'extra',
  'leadingComments',
  'trailingComments',
]);

/** Walk the AST and yield every JSXOpeningElement + every createElement-shaped CallExpression. */
function collectCandidates(
  root: Node,
): Array<{ kind: SourceMatchKind; node: JSXOpeningElement | CallExpression }> {
  const out: Array<{ kind: SourceMatchKind; node: JSXOpeningElement | CallExpression }> = [];

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const n = node as Record<string, unknown> & { type?: string };
    if (n.type === 'JSXOpeningElement') {
      out.push({ kind: 'jsx-opening', node: n as unknown as JSXOpeningElement });
    } else if (n.type === 'CallExpression' && isCreateElementCall(n as unknown as CallExpression)) {
      out.push({ kind: 'create-element', node: n as unknown as CallExpression });
    }
    for (const key in n) {
      if (SKIP_KEYS.has(key)) continue;
      const child = n[key];
      if (child && typeof child === 'object') visit(child);
    }
  };

  visit(root);
  return out;
}

function isCreateElementCall(call: CallExpression): boolean {
  const callee = call.callee;
  // `React.createElement(...)` or `createElement(...)` (after dropping the React. namespace).
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'React' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'createElement'
  ) {
    return true;
  }
  if (callee.type === 'Identifier' && callee.name === 'createElement') {
    return true;
  }
  return false;
}

function jsxOpeningTag(node: JSXOpeningElement): string | null {
  if (node.name.type !== 'JSXIdentifier') return null;
  return node.name.name.toLowerCase();
}

function jsxOpeningClassList(node: JSXOpeningElement): string[] | 'unsupported' {
  for (const attr of node.attributes) {
    if (attr.type !== 'JSXAttribute') continue;
    if (attr.name.type !== 'JSXIdentifier') continue;
    if (attr.name.name !== 'className' && attr.name.name !== 'class') continue;
    const v = attr.value;
    if (!v) return [];
    if (v.type === 'StringLiteral') {
      return splitClasses(v.value);
    }
    if (v.type === 'JSXExpressionContainer') {
      const inner = v.expression;
      if (inner.type === 'StringLiteral') return splitClasses(inner.value);
      if (inner.type === 'TemplateLiteral' && inner.expressions.length === 0) {
        return splitClasses(inner.quasis[0]?.value.cooked ?? '');
      }
      // Anything else (cn(), ternary, etc.) — unsupported for class scoring.
      return 'unsupported';
    }
  }
  return [];
}

function createElementTag(call: CallExpression): string | null {
  const arg0 = call.arguments[0];
  if (!arg0 || arg0.type !== 'StringLiteral') return null;
  return arg0.value.toLowerCase();
}

/** Find the props ObjectExpression in a createElement call, or null when it's a non-object literal. */
export function createElementPropsObject(call: CallExpression): ObjectExpression | null {
  const arg1 = call.arguments[1];
  if (!arg1) return null;
  if (arg1.type === 'ObjectExpression') return arg1;
  return null;
}

function createElementClassList(call: CallExpression): string[] | 'unsupported' {
  const props = createElementPropsObject(call);
  if (!props) {
    // No props object (e.g. `createElement("div")`) means no className — class score 0.
    return [];
  }
  const classProp = findObjectProperty(props, 'className') ?? findObjectProperty(props, 'class');
  if (!classProp) return [];
  const v = classProp.value;
  if (v.type === 'StringLiteral') return splitClasses(v.value);
  if (v.type === 'TemplateLiteral' && v.expressions.length === 0) {
    return splitClasses(v.quasis[0]?.value.cooked ?? '');
  }
  return 'unsupported';
}

export function findObjectProperty(obj: ObjectExpression, name: string): ObjectProperty | null {
  for (const prop of obj.properties) {
    if (prop.type !== 'ObjectProperty') continue;
    if (prop.computed) continue;
    if (prop.key.type === 'Identifier' && prop.key.name === name) return prop;
    if (prop.key.type === 'StringLiteral' && prop.key.value === name) return prop;
  }
  return null;
}

function splitClasses(s: string): string[] {
  return s
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: findSourceMatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate the source-code position that corresponds to a runtime outerHTML
 * snippet. Searches both JSX literals and `React.createElement` call shapes,
 * scoring each candidate by tag-name match + className intersection.
 *
 * @param source  Full file source.
 * @param snippet Runtime outerHTML (or its opening tag) captured by overlay.
 * @returns       Best match, or `null` when nothing in source is plausibly the
 *                target (no JSXOpeningElement / createElement of the same tag,
 *                or — when the snippet has classes — no candidate with any
 *                class overlap).
 */
export function findSourceMatch(source: string, snippet: string): SourceMatch | null {
  const info = parseSnippet(snippet);
  if (!info) return null;

  let ast;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
  } catch {
    return null;
  }

  const candidates = collectCandidates(ast as unknown as Node);

  let best: { score: number; match: SourceMatch } | null = null;

  for (const cand of candidates) {
    let tag: string | null;
    let classList: string[] | 'unsupported';
    if (cand.kind === 'jsx-opening') {
      tag = jsxOpeningTag(cand.node as JSXOpeningElement);
      classList = jsxOpeningClassList(cand.node as JSXOpeningElement);
    } else {
      tag = createElementTag(cand.node as CallExpression);
      classList = createElementClassList(cand.node as CallExpression);
    }
    if (!tag || tag !== info.tag) continue;

    // Score: tag match = 1, plus 1 per snippet-class that's also on this candidate.
    let score = 1;
    if (classList === 'unsupported') {
      // Treat as "tag-only" candidate; still eligible to win when nothing else matches.
    } else if (info.classList.length === 0) {
      // Snippet has no classes → tag-only match is fine. Bonus if the candidate has no class either.
      if (classList.length === 0) score += 0.5;
    } else {
      const candSet = new Set(classList);
      let overlap = 0;
      for (const c of info.classList) if (candSet.has(c)) overlap += 1;
      // If snippet has classes but this candidate matches none, it's likely the
      // wrong element — skip when there are other candidates with overlap.
      if (overlap === 0) {
        // Keep as a fallback (score == 1) in case no candidate has class data
        // (e.g. all unsupported), but downrank.
        score = 0.1;
      } else {
        score += overlap;
      }
    }

    const node = cand.node;
    if (node.start == null || node.end == null) continue;

    const candidate: SourceMatch = {
      kind: cand.kind,
      tag,
      start: node.start,
      end: node.end,
      node: node as JSXOpeningElement | CallExpression,
      outerHTMLAnchor: source.slice(node.start, node.end),
    };
    if (!best || score > best.score) {
      best = { score, match: candidate };
    }
  }

  return best?.match ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: legacy `outerHTML.includes` lookup as a final-fallback path
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_OPENING_RE = /^<[a-zA-Z][^<]*?>/;

export function legacyOpeningTag(snippet: string): string {
  const m = snippet.match(LEGACY_OPENING_RE);
  return m ? m[0] : snippet;
}

/**
 * Last-ditch byte-substring lookup — kept for backward compatibility with
 * the old behaviour. Prefer `findSourceMatch` for new code; this helper is
 * only useful when callers want to mirror the original "exact opening tag
 * match" semantics (e.g. for HTML files where AST parsing isn't appropriate).
 */
export function legacyIndexOfOpening(source: string, snippet: string): number {
  return source.indexOf(legacyOpeningTag(snippet));
}
