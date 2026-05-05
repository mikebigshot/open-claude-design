// AST-based className write-back for Edit mode (P2-8).
//
// Symmetric to persist-edit-styles.ts but mutates JSX `className` attributes
// instead of `style` props. Uses @babel/parser ONLY — see notes below for
// why @babel/traverse and @babel/generator are NOT in the dep tree. The
// user's flow:
//
//   1. Edit mode pin selects an element → ELEMENT_SELECTED.outerHTML lands.
//   2. EditFloat slider/swatch invokes onStyleChange(prop, value).
//   3. PreviewPanel maps the (prop, value) to {add: ['bg-blue-500'], remove:
//      ['bg-red-500']} via css-to-tailwind.ts.
//   4. PreviewPanel queues this change in pendingClassEditsRef keyed by selector.
//   5. On leaving Edit mode, persistEditClassNames walks the queue, finds each
//      JSXOpeningElement by snippet anchor, mutates its className, generates,
//      and PUTs the new source.
//
// Three className shapes we recognize in JSX:
//
//   - `className="x y z"`              → string literal (easy)
//   - `className={"x y z"}`            → JSXExpressionContainer wrapping a
//                                         StringLiteral (treated as string)
//   - `className={cn(a, b, c)}`        → JSXExpressionContainer wrapping a
//                                         CallExpression — we DO NOT modify
//                                         these (warn + skip; falls back to
//                                         inline style at the caller layer).
//
// Files we attempt to modify: any file whose source includes the snippet's
// opening tag. We restrict to JSX-bearing extensions (.jsx, .tsx, .js, .ts)
// so we don't try to parse pure HTML or JSON files. .html files use the
// inline-style branch only — there is no classname-via-AST equivalent for
// raw HTML.

import type { CallExpression, JSXAttribute, JSXOpeningElement } from '@babel/types';

import { api } from '@/lib/api';
import {
  createElementPropsObject,
  findObjectProperty,
  findSourceMatch,
} from './persist-edit-utils';

// We deliberately do NOT use @babel/traverse — it pulls in
// @babel/helper-environment-visitor / @babel/helper-validator-identifier which
// reference `process.env.NODE_ENV` at module load. Vite's dep optimizer can't
// substitute that for browser builds, so an `import` of @babel/traverse blows
// up at module-load with `ReferenceError: process is not defined` — and
// because this module is reached transitively from PreviewPanel → Workspace →
// main.tsx, the whole React tree fails to mount (blank page). The hand-rolled
// walker in persist-edit-utils.ts covers everything we need without the dep.
//
// We also do NOT use @babel/generator. The whole-tree round-trip would
// reformat untouched regions of the source (string-quote normalization, etc.).
// Instead we splice the AST node's start/end byte range in the original source
// — minimal-diff edit that preserves formatting.

// (Unused parameter type retained for clarity in mutateJsxClassName below.)

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassChange {
  add: string[];
  remove: string[];
}

export interface PendingClassEditEntry {
  /** Selector from ELEMENT_SELECTED.selector — for debugging only. */
  selector: string;
  /** Original outerHTML used as the anchor for source lookup. */
  outerHTMLSnippet: string;
  /** Accumulated add/remove sets — kept de-duplicated. */
  add: Set<string>;
  remove: Set<string>;
}

export interface PersistFile {
  path: string;
  content: string;
}

export interface PersistResult {
  written: number;
  missed: number;
  /** Number of edits that bailed because className was a non-trivial expression (e.g. cn(...)). */
  unsupported: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// File-finder — AST-aware (P2-12) so createElement-style code resolves too.
// ─────────────────────────────────────────────────────────────────────────────

function findClassNameTargetFile<F extends { path: string; content: string }>(
  files: readonly F[],
  snippet: string,
): F | undefined {
  for (const f of files) {
    if (!isJsxFile(f.path)) continue;
    const m = findSourceMatch(f.content, snippet);
    if (m) return f;
  }
  return undefined;
}

function isJsxFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.jsx') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.ts')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Class-list manipulation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Apply add/remove to a space-separated class list, preserving relative order of survivors. */
function mutateClassList(current: string, change: ClassChange): string {
  const tokens = current.split(/\s+/).filter(Boolean);
  const removeSet = new Set(change.remove);
  const filtered = tokens.filter((t) => !removeSet.has(t));
  const existing = new Set(filtered);
  for (const cls of change.add) {
    if (!existing.has(cls)) {
      filtered.push(cls);
      existing.add(cls);
    }
  }
  return filtered.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// AST mutation core
// ─────────────────────────────────────────────────────────────────────────────

interface ApplyResult {
  source: string;
  status: 'changed' | 'unchanged' | 'unsupported' | 'not-found' | 'parse-error';
}

/**
 * Locate the JSXOpeningElement whose source text contains `snippet`'s opening
 * tag and mutate its `className` attribute per `change`. Returns the new
 * source plus a status indicating what happened.
 *
 * - 'changed': className was modified and source updated.
 * - 'unchanged': className value would be identical to current — no write.
 * - 'unsupported': className is a non-string expression we can't safely edit.
 * - 'not-found': no JSXOpeningElement in the AST whose source spans the snippet.
 * - 'parse-error': source did not parse as JSX/TS.
 */
export function applyClassChangeToSource(
  source: string,
  filePath: string,
  snippet: string,
  change: ClassChange,
): ApplyResult {
  if (change.add.length === 0 && change.remove.length === 0) {
    return { source, status: 'unchanged' };
  }
  if (!isJsxFile(filePath)) {
    return { source, status: 'unsupported' };
  }

  // P2-12 — search by tag + class intersection (AST). Handles JSX literals AND
  // React.createElement, and is robust to JSX prop-order skew vs outerHTML.
  const match = findSourceMatch(source, snippet);
  if (!match) {
    return { source, status: 'not-found' };
  }

  if (match.kind === 'jsx-opening') {
    return mutateJsxClassName(source, match.node as JSXOpeningElement, change);
  }
  return mutateCreateElementClassName(source, match.node as CallExpression, change);
}

// ───────── JSX className mutation ─────────

function mutateJsxClassName(
  source: string,
  tNode: JSXOpeningElement,
  change: ClassChange,
): ApplyResult {
  const classAttr = tNode.attributes.find(
    (a): a is JSXAttribute =>
      a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'className',
  );

  if (!classAttr) {
    // No className attribute yet — synthesize one.
    if (change.add.length === 0) {
      return { source, status: 'unchanged' };
    }
    const newClassValue = mutateClassList('', change);
    if (!newClassValue) return { source, status: 'unchanged' };
    return injectAttribute(source, tNode, ` className="${newClassValue}"`);
  }

  // Existing className. Three shapes:
  //   1. value is StringLiteral
  //   2. value is JSXExpressionContainer wrapping StringLiteral
  //   3. value is JSXExpressionContainer wrapping anything else (cn(...), {...}, ternary, etc) → unsupported
  let currentClasses = '';
  let kind: 'string-attr' | 'expr-string' | 'unsupported' = 'unsupported';
  if (classAttr.value?.type === 'StringLiteral') {
    currentClasses = classAttr.value.value;
    kind = 'string-attr';
  } else if (classAttr.value?.type === 'JSXExpressionContainer') {
    const inner = classAttr.value.expression;
    if (inner.type === 'StringLiteral') {
      currentClasses = inner.value;
      kind = 'expr-string';
    } else if (inner.type === 'TemplateLiteral' && inner.expressions.length === 0) {
      // `className={`x y z`}` with no interpolations.
      currentClasses = inner.quasis[0]?.value.cooked ?? '';
      kind = 'expr-string';
    }
  }

  if (kind === 'unsupported') {
    return { source, status: 'unsupported' };
  }

  const nextClasses = mutateClassList(currentClasses, change);
  if (nextClasses === currentClasses) {
    return { source, status: 'unchanged' };
  }

  // Re-emit the attribute value. Splice the attribute value range in place —
  // minimal-diff edit that preserves formatting.
  const valueNode = classAttr.value;
  if (!valueNode || valueNode.start == null || valueNode.end == null) {
    return { source, status: 'unchanged' };
  }
  const newValueText = kind === 'string-attr' ? `"${nextClasses}"` : `{"${nextClasses}"}`;
  const next = source.slice(0, valueNode.start) + newValueText + source.slice(valueNode.end);
  return { source: next, status: 'changed' };
}

// ───────── createElement className mutation ─────────

function mutateCreateElementClassName(
  source: string,
  call: CallExpression,
  change: ClassChange,
): ApplyResult {
  const props = createElementPropsObject(call);
  if (!props) {
    // No props or props arg is null/undefined/non-object → don't try to fabricate.
    // We could synthesize, but conservative path is safer for V1.
    return { source, status: 'unsupported' };
  }
  const classProp = findObjectProperty(props, 'className') ?? findObjectProperty(props, 'class');
  if (!classProp) {
    if (change.add.length === 0) {
      return { source, status: 'unchanged' };
    }
    const newClassValue = mutateClassList('', change);
    if (!newClassValue) return { source, status: 'unchanged' };
    // Insert into props object — `className: "..."` literal.
    return insertClassNameProperty(source, props, newClassValue);
  }
  // Existing className prop. Only support StringLiteral + TemplateLiteral-w/o-expressions.
  let currentClasses = '';
  let isTemplate = false;
  if (classProp.value.type === 'StringLiteral') {
    currentClasses = classProp.value.value;
  } else if (
    classProp.value.type === 'TemplateLiteral' &&
    classProp.value.expressions.length === 0
  ) {
    currentClasses = classProp.value.quasis[0]?.value.cooked ?? '';
    isTemplate = true;
  } else {
    return { source, status: 'unsupported' };
  }

  const nextClasses = mutateClassList(currentClasses, change);
  if (nextClasses === currentClasses) {
    return { source, status: 'unchanged' };
  }
  const valueNode = classProp.value;
  if (valueNode.start == null || valueNode.end == null) {
    return { source, status: 'unchanged' };
  }
  const newValueText = isTemplate ? `\`${nextClasses}\`` : `"${nextClasses}"`;
  const next = source.slice(0, valueNode.start) + newValueText + source.slice(valueNode.end);
  return { source: next, status: 'changed' };
}

/** Insert `className: "..."` into a non-empty or empty props ObjectExpression. */
function insertClassNameProperty(
  source: string,
  obj: import('@babel/types').ObjectExpression,
  classValue: string,
): ApplyResult {
  if (obj.start == null || obj.end == null) return { source, status: 'unchanged' };
  const propText = `className: "${classValue}"`;
  if (obj.properties.length === 0) {
    const replacement = `{ ${propText} }`;
    return {
      source: source.slice(0, obj.start) + replacement + source.slice(obj.end),
      status: 'changed',
    };
  }
  const closeIdx = obj.end - 1;
  if (source[closeIdx] !== '}') return { source, status: 'unchanged' };
  let insertAt = closeIdx;
  while (insertAt > obj.start + 1 && /\s/.test(source[insertAt - 1] ?? '')) insertAt -= 1;
  const needsComma = source[insertAt - 1] !== ',' && source[insertAt - 1] !== '{';
  const chunk = (needsComma ? ', ' : ' ') + propText + ' ';
  return {
    source: source.slice(0, insertAt) + chunk + source.slice(insertAt),
    status: 'changed',
  };
}

/** Insert ` className="..."` immediately before the closing `>` / `/>` of a JSXOpeningElement. */
function injectAttribute(source: string, node: JSXOpeningElement, attrText: string): ApplyResult {
  if (node.end == null) return { source, status: 'unchanged' };
  // Walk back from node.end to find the position of `>` or `/>`. Skip whitespace.
  let i = node.end - 1;
  while (i > 0 && (source[i] === '>' || source[i] === '/' || /\s/.test(source[i] ?? ''))) {
    i -= 1;
  }
  // Now i points at last non-`>` char; insert after it.
  const insertAt = i + 1;
  const next = source.slice(0, insertAt) + attrText + source.slice(insertAt);
  return { source: next, status: 'changed' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending-edit accumulator
// ─────────────────────────────────────────────────────────────────────────────

export function mergePendingClassEdit(
  map: Map<string, PendingClassEditEntry>,
  selector: string,
  outerHTML: string,
  change: ClassChange,
): Map<string, PendingClassEditEntry> {
  const next = new Map(map);
  const existing = next.get(selector);
  if (existing) {
    const newAdd = new Set(existing.add);
    const newRemove = new Set(existing.remove);
    for (const cls of change.add) {
      newRemove.delete(cls); // a later add cancels an earlier remove
      newAdd.add(cls);
    }
    for (const cls of change.remove) {
      newAdd.delete(cls); // a later remove cancels an earlier add
      newRemove.add(cls);
    }
    next.set(selector, { ...existing, add: newAdd, remove: newRemove });
  } else {
    next.set(selector, {
      selector,
      outerHTMLSnippet: outerHTML,
      add: new Set(change.add),
      remove: new Set(change.remove),
    });
  }
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

export async function persistEditClassNames(
  projectId: string,
  files: readonly PersistFile[],
  pending: Map<string, PendingClassEditEntry>,
): Promise<PersistResult> {
  let written = 0;
  let missed = 0;
  let unsupported = 0;

  await Promise.all(
    Array.from(pending.values()).map(async (entry) => {
      const target = findClassNameTargetFile(files, entry.outerHTMLSnippet);
      if (!target) {
        missed += 1;
        return;
      }
      const result = applyClassChangeToSource(target.content, target.path, entry.outerHTMLSnippet, {
        add: Array.from(entry.add),
        remove: Array.from(entry.remove),
      });
      if (result.status === 'unsupported') {
        unsupported += 1;
        return;
      }
      if (result.status !== 'changed') {
        // 'unchanged' / 'not-found' / 'parse-error' — leave file alone.
        if (result.status === 'not-found' || result.status === 'parse-error') missed += 1;
        return;
      }
      try {
        await api(
          `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(target.path)}`,
          {
            method: 'PUT',
            body: { path: target.path, content: result.source } as unknown as BodyInit,
            keepalive: true,
          },
        );
        written += 1;
      } catch (err) {
        console.warn('[edit] failed to persist className', target.path, err);
        missed += 1;
      }
    }),
  );

  return { written, missed, unsupported };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for tests
// ─────────────────────────────────────────────────────────────────────────────

// Internal helper exported solely for unit tests so we can verify class-list
// edge cases without going through the AST round-trip.
export const __testing = { mutateClassList };
