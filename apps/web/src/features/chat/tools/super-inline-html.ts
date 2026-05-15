// super_inline_html — bundle an HTML file and its referenced assets into a
// single self-contained HTML file that works offline. v2 official tool name +
// input schema; the implementation runs entirely in the browser.
//
// Coverage (10 / 10 asset families):
//   1. <link rel="stylesheet" href>      → <style>…</style>
//   2. <script src>                      → <script>…</script>
//   3. <img src>                         → data: URI
//   4. <img srcset>                      → rewrite every candidate
//   5. <video src> / <video poster> / <audio src> / <source src>
//   6. <picture><source srcset>          → rewrite every candidate
//   7. <link rel="icon" / apple-touch-icon / mask-icon / shortcut icon href>
//   8. <svg image href> / <svg use href> / <svg use xlink:href> (preserve frag)
//   9. <style> CSS text — url() rewrites (inline-authored only — link-derived
//      blocks skipped to avoid base-path drift)
//  10. [style] inline attribute — url() rewrites
//
// Asset fetches are deduped via an in-call Map; each unique resolved path is
// requested at most once.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

const InputSchema = z.object({
  input_path: z.string().describe('Project-relative path to the source HTML file.'),
  output_path: z.string().describe('Project-relative path for the bundled output file.'),
});

type Input = z.infer<typeof InputSchema>;
type Output =
  | {
      ok: true;
      output_path: string;
      assetsInlined: number;
      bytes: number;
      warnings: string[];
    }
  | { ok: false; error: 'invalid_input'; message: string }
  | { ok: false; error: 'input_not_found'; message: string }
  | { ok: false; error: 'missing_thumbnail'; message: string }
  | { ok: false; error: 'write_failed'; message: string };

export interface SuperInlineHtmlDeps {
  fetchImpl?: typeof fetch;
}

type TextAsset = { kind: 'text'; body: string; type: string };
type BinaryAsset = { kind: 'binary'; bytes: Uint8Array; type: string };
type Asset = TextAsset | BinaryAsset;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes);
}

function dataUriOf(asset: Asset): string {
  if (asset.kind === 'binary') return `data:${asset.type};base64,${bytesToBase64(asset.bytes)}`;
  return `data:${asset.type};base64,${textToBase64(asset.body)}`;
}

function resolveRelativePath(baseHtmlPath: string, ref: string): string {
  if (/^[a-z]+:\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('//')) return ref;
  if (ref.startsWith('/')) return ref.replace(/^\/+/, '');
  const baseDir = baseHtmlPath.includes('/')
    ? baseHtmlPath.slice(0, baseHtmlPath.lastIndexOf('/'))
    : '';
  const parts = baseDir ? baseDir.split('/') : [];
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

function buildAssetUrl(projectId: string, path: string): string {
  const encoded = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files/${encoded}`);
}

/** External / data-URI / pure-fragment refs are left alone. */
function isExternalOrSkippable(url: string): boolean {
  if (!url) return true;
  // `scheme:` (data:, http:, https:, mailto:, tel:, blob:, etc.)
  if (/^[a-z][a-z0-9+.\-]*:/i.test(url)) return true;
  // protocol-relative or intra-doc fragment
  if (url.startsWith('//') || url.startsWith('#')) return true;
  return false;
}

/** srcset = "<url> <desc>, <url> <desc>, …"; separator is comma + whitespace
 *  (so commas inside `data:` URIs survive). */
function parseSrcset(s: string): Array<{ url: string; desc: string }> {
  if (!s.trim()) return [];
  return s.split(/,\s+/).map((part) => {
    const trimmed = part.trim();
    const sp = trimmed.search(/\s/);
    if (sp === -1) return { url: trimmed, desc: '' };
    return { url: trimmed.slice(0, sp), desc: trimmed.slice(sp).trim() };
  });
}

function serializeSrcset(items: Array<{ url: string; desc: string }>): string {
  return items.map((it) => (it.desc ? `${it.url} ${it.desc}` : it.url)).join(', ');
}

export function superInlineHtmlTool(projectId: string, deps?: SuperInlineHtmlDeps) {
  const fetchImpl: typeof fetch = deps?.fetchImpl ?? ((...a) => fetch(...a));

  return tool<Input, Output>({
    description:
      'Bundle an HTML file and all its referenced assets (images, CSS, JS, fonts, video, audio, SVG sprites) into a single self-contained HTML file that works offline. Inlines stylesheets and scripts as inline blocks; everything else (images, fonts, audio/video, srcset candidates, CSS url(), inline [style] url(), SVG <use>/<image> hrefs) becomes data: URIs. The source HTML MUST contain a <template id="__bundler_thumbnail"> with a small SVG preview used as the splash while the bundle loads.',
    inputSchema: InputSchema,
    execute: async (input, ctx) => {
      const parsed = InputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: 'invalid_input',
          message: `super_inline_html input failed validation: ${parsed.error.message}`,
        };
      }
      const { input_path, output_path } = parsed.data;
      const abortSignal = ctx?.abortSignal;
      const warnings: string[] = [];
      let assetsInlined = 0;

      // 1. Fetch the source HTML.
      const sourceUrl = buildAssetUrl(projectId, input_path);
      const sourceRes = await fetchImpl(sourceUrl, { signal: abortSignal });
      if (sourceRes.status === 404) {
        return {
          ok: false,
          error: 'input_not_found',
          message: `Source HTML not found at "${input_path}".`,
        };
      }
      if (!sourceRes.ok) {
        return {
          ok: false,
          error: 'input_not_found',
          message: `Failed to fetch source HTML at "${input_path}": HTTP ${sourceRes.status}`,
        };
      }
      const rawHtml = await sourceRes.text();

      // 2. Parse + thumbnail presence check.
      const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
      if (!doc.querySelector('template#__bundler_thumbnail')) {
        return {
          ok: false,
          error: 'missing_thumbnail',
          message:
            'Source HTML must contain <template id="__bundler_thumbnail"> with a small SVG preview. Add one (30% padding around an iconographic SVG, ≤ 2KB) and retry.',
        };
      }

      // 3. Dedup asset cache + fetch helper.
      const cache = new Map<string, Asset | null>();
      async function getAsset(refPath: string): Promise<Asset | null> {
        if (cache.has(refPath)) return cache.get(refPath)!;
        const url = buildAssetUrl(projectId, refPath);
        let res: Response;
        try {
          res = await fetchImpl(url, { signal: abortSignal });
        } catch (e) {
          warnings.push(
            `Failed to fetch "${refPath}": ${e instanceof Error ? e.message : String(e)}`,
          );
          cache.set(refPath, null);
          return null;
        }
        if (!res.ok) {
          warnings.push(`Asset "${refPath}" returned HTTP ${res.status}; left as-is in bundle.`);
          cache.set(refPath, null);
          return null;
        }
        const type = res.headers.get('content-type') ?? 'application/octet-stream';
        let asset: Asset;
        if (type.startsWith('text/') || type.includes('javascript') || type.includes('json')) {
          asset = { kind: 'text', body: await res.text(), type };
        } else {
          asset = { kind: 'binary', bytes: new Uint8Array(await res.arrayBuffer()), type };
        }
        cache.set(refPath, asset);
        return asset;
      }

      // Track styles that were inlined-from-<link> so the CSS-text walker
      // skips them (base-path drift between html-dir and stylesheet-dir).
      const linkDerivedStyles = new WeakSet<Element>();

      // 4. <link rel~="stylesheet" href> → <style>…</style>
      for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
        const href = link.getAttribute('href') ?? '';
        if (isExternalOrSkippable(href)) continue;
        const asset = await getAsset(resolveRelativePath(input_path, href));
        if (!asset) continue;
        if (asset.kind !== 'text') {
          warnings.push(`Stylesheet "${href}" had non-text content-type ${asset.type}; skipped.`);
          continue;
        }
        const style = doc.createElement('style');
        style.setAttribute('data-from', href);
        style.textContent = `\n${asset.body}\n`;
        link.replaceWith(style);
        linkDerivedStyles.add(style);
        assetsInlined += 1;
      }

      // 5. <script src> → inline body (preserve other attrs)
      for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
        const src = script.getAttribute('src') ?? '';
        if (isExternalOrSkippable(src)) continue;
        const asset = await getAsset(resolveRelativePath(input_path, src));
        if (!asset) continue;
        if (asset.kind !== 'text') {
          warnings.push(`Script "${src}" had non-text content-type ${asset.type}; skipped.`);
          continue;
        }
        script.removeAttribute('src');
        script.textContent = `\n${asset.body}\n`;
        assetsInlined += 1;
      }

      // 6. <img src> → data: URI
      for (const img of Array.from(doc.querySelectorAll('img[src]'))) {
        const src = img.getAttribute('src') ?? '';
        if (isExternalOrSkippable(src)) continue;
        const asset = await getAsset(resolveRelativePath(input_path, src));
        if (!asset) continue;
        if (asset.kind !== 'binary') {
          warnings.push(`Image "${src}" returned text content-type ${asset.type}; left as-is.`);
          continue;
        }
        img.setAttribute('src', dataUriOf(asset));
        assetsInlined += 1;
      }

      // 7. srcset (img + source) — each candidate rewritten in place.
      async function rewriteSrcset(el: Element): Promise<void> {
        const original = el.getAttribute('srcset');
        if (!original) return;
        const cands = parseSrcset(original);
        let mutated = false;
        for (const c of cands) {
          if (isExternalOrSkippable(c.url)) continue;
          const asset = await getAsset(resolveRelativePath(input_path, c.url));
          if (!asset || asset.kind !== 'binary') continue;
          c.url = dataUriOf(asset);
          mutated = true;
          assetsInlined += 1;
        }
        if (mutated) el.setAttribute('srcset', serializeSrcset(cands));
      }
      for (const el of Array.from(doc.querySelectorAll('img[srcset]'))) await rewriteSrcset(el);
      for (const el of Array.from(doc.querySelectorAll('source[srcset]'))) await rewriteSrcset(el);

      // 8. <video src/poster>, <audio src>, <source src> → data: URI
      const binaryAttrTargets: Array<{ sel: string; attr: string }> = [
        { sel: 'video[src]', attr: 'src' },
        { sel: 'video[poster]', attr: 'poster' },
        { sel: 'audio[src]', attr: 'src' },
        { sel: 'source[src]', attr: 'src' },
      ];
      for (const { sel, attr } of binaryAttrTargets) {
        for (const el of Array.from(doc.querySelectorAll(sel))) {
          const v = el.getAttribute(attr) ?? '';
          if (isExternalOrSkippable(v)) continue;
          const asset = await getAsset(resolveRelativePath(input_path, v));
          if (!asset) continue;
          if (asset.kind !== 'binary') {
            warnings.push(
              `<${el.tagName.toLowerCase()} ${attr}="${v}"> returned text content-type ${asset.type}; left as-is.`,
            );
            continue;
          }
          el.setAttribute(attr, dataUriOf(asset));
          assetsInlined += 1;
        }
      }

      // 9. <link rel~="icon|apple-touch-icon|mask-icon|shortcut icon" href> → data: URI
      const iconLinks = Array.from(doc.querySelectorAll('link[href]')).filter((el) => {
        const rel = (el.getAttribute('rel') ?? '').toLowerCase();
        return /\b(?:icon|apple-touch-icon|mask-icon|shortcut\s+icon)\b/.test(rel);
      });
      for (const link of iconLinks) {
        const href = link.getAttribute('href') ?? '';
        if (isExternalOrSkippable(href)) continue;
        const asset = await getAsset(resolveRelativePath(input_path, href));
        if (!asset) continue;
        if (asset.kind !== 'binary') {
          warnings.push(
            `<link rel="icon" href="${href}"> returned text content-type ${asset.type}; left as-is.`,
          );
          continue;
        }
        link.setAttribute('href', dataUriOf(asset));
        assetsInlined += 1;
      }

      // 10. <svg image|use href|xlink:href> — preserve fragment after rewrite
      for (const el of Array.from(doc.querySelectorAll('image, use'))) {
        for (const attr of ['href', 'xlink:href']) {
          const val = el.getAttribute(attr);
          if (!val) continue;
          if (isExternalOrSkippable(val)) continue;
          const hashIdx = val.indexOf('#');
          const pathPart = hashIdx === -1 ? val : val.slice(0, hashIdx);
          const frag = hashIdx === -1 ? '' : val.slice(hashIdx); // includes leading #
          if (!pathPart) continue; // pure-fragment ref (intra-doc) — already covered by isExternal
          const asset = await getAsset(resolveRelativePath(input_path, pathPart));
          if (!asset) continue;
          const uri = dataUriOf(asset);
          el.setAttribute(attr, frag ? `${uri}${frag}` : uri);
          assetsInlined += 1;
        }
      }

      // 11. CSS text rewrites — <style> children + [style] inline attribute.
      async function rewriteCssText(text: string): Promise<{ text: string; count: number }> {
        const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
        const seen = new Set<string>();
        const replacements: Array<{ raw: string; replacement: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const raw = m[0]!;
          const quote = m[1] ?? '';
          const url = m[2]!;
          if (seen.has(raw)) continue;
          seen.add(raw);
          if (isExternalOrSkippable(url)) continue;
          const asset = await getAsset(resolveRelativePath(input_path, url));
          if (!asset || asset.kind !== 'binary') continue;
          const uri = dataUriOf(asset);
          replacements.push({ raw, replacement: `url(${quote}${uri}${quote})` });
        }
        let out = text;
        for (const r of replacements) out = out.split(r.raw).join(r.replacement);
        return { text: out, count: replacements.length };
      }
      for (const style of Array.from(doc.querySelectorAll('style'))) {
        if (linkDerivedStyles.has(style)) continue; // skip link-inlined blocks
        const original = style.textContent ?? '';
        if (!original.includes('url(')) continue;
        const { text, count } = await rewriteCssText(original);
        if (count > 0) {
          style.textContent = text;
          assetsInlined += count;
        }
      }
      for (const el of Array.from(doc.querySelectorAll('[style]'))) {
        const inline = el.getAttribute('style') ?? '';
        if (!inline.includes('url(')) continue;
        const { text, count } = await rewriteCssText(inline);
        if (count > 0) {
          el.setAttribute('style', text);
          assetsInlined += count;
        }
      }

      // 12. Serialize back. Preserve doctype if original had one.
      const doctypeStr = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : '';
      const html = doctypeStr + doc.documentElement.outerHTML;

      // 13. PUT the bundled HTML back to the project.
      const outUrl = buildAssetUrl(projectId, output_path);
      let writeRes: Response;
      try {
        writeRes = await fetchImpl(outUrl, {
          method: 'PUT',
          body: html,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          signal: abortSignal,
        });
      } catch (e) {
        return {
          ok: false,
          error: 'write_failed',
          message: `Failed to write bundled HTML: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      if (!writeRes.ok) {
        return {
          ok: false,
          error: 'write_failed',
          message: `Failed to write bundled HTML: HTTP ${writeRes.status}`,
        };
      }

      return {
        ok: true,
        output_path,
        assetsInlined,
        bytes: new TextEncoder().encode(html).length,
        warnings,
      };
    },
  });
}
