// super_inline_html — bundle an HTML file and its referenced assets into a
// single self-contained HTML that works offline. v2 official tool name +
// input schema; the implementation runs entirely in the browser (no worker
// roundtrip beyond fetching the source files).
//
// Coverage: <link rel="stylesheet">, <script src>, <img src>. CSS @import /
// font-face url(), <video>/<audio>, <picture><source>, srcset, preload link
// hints — NOT YET inlined (each is a separate hunk of work; document the
// limit and add follow-up tickets).

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

interface FileEntry {
  path: string;
  mediaType?: string;
  mimeType?: string;
}

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

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function resolveRelativePath(baseHtmlPath: string, ref: string): string {
  // Already absolute / scheme'd — leave alone.
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

/** Escape a string for safe insertion into a quoted HTML attribute value. */
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function superInlineHtmlTool(projectId: string, deps?: SuperInlineHtmlDeps) {
  const fetchImpl: typeof fetch = deps?.fetchImpl ?? ((...a) => fetch(...a));

  return tool<Input, Output>({
    description:
      'Bundle an HTML file and all its referenced assets (images, CSS, JS) into a single self-contained HTML file that works offline. Inlines <link rel="stylesheet"> / <script src> / <img src> as inline blocks or data: URIs. The source HTML MUST contain a <template id="__bundler_thumbnail"> with a small SVG preview used as the splash while the bundle loads.',
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
      let html = await sourceRes.text();

      // 2. Validate __bundler_thumbnail presence before doing anything else.
      if (!/<template[^>]*\sid=["']__bundler_thumbnail["']/i.test(html)) {
        return {
          ok: false,
          error: 'missing_thumbnail',
          message:
            'Source HTML must contain <template id="__bundler_thumbnail"> with a small SVG preview. Add one (30% padding around an iconographic SVG, ≤ 2KB) and retry.',
        };
      }

      // 3. Helper to fetch one asset; returns its body or null with a warning.
      async function fetchAsset(refPath: string): Promise<
        { kind: 'text'; body: string; type: string } | { kind: 'binary'; bytes: Uint8Array; type: string } | null
      > {
        const url = buildAssetUrl(projectId, refPath);
        let res: Response;
        try {
          res = await fetchImpl(url, { signal: abortSignal });
        } catch (e) {
          warnings.push(`Failed to fetch "${refPath}": ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
        if (!res.ok) {
          warnings.push(`Asset "${refPath}" returned HTTP ${res.status}; left as-is in bundle.`);
          return null;
        }
        const type = res.headers.get('content-type') ?? 'application/octet-stream';
        if (type.startsWith('text/') || type.includes('javascript') || type.includes('json')) {
          return { kind: 'text', body: await res.text(), type };
        }
        return { kind: 'binary', bytes: new Uint8Array(await res.arrayBuffer()), type };
      }

      let assetsInlined = 0;

      // 4. Inline <link rel="stylesheet" href="..."> →
      //    <style data-from="...">...css...</style>
      const linkRe = /<link\b[^>]*?\brel=["']stylesheet["'][^>]*?\bhref=["']([^"']+)["'][^>]*?\/?>/gi;
      const linkMatches: Array<{ raw: string; href: string }> = [];
      for (const m of html.matchAll(linkRe)) linkMatches.push({ raw: m[0], href: m[1]! });
      for (const { raw, href } of linkMatches) {
        const resolved = resolveRelativePath(input_path, href);
        const asset = await fetchAsset(resolved);
        if (!asset) continue;
        if (asset.kind !== 'text') {
          warnings.push(`Stylesheet "${href}" had non-text content-type ${asset.type}; skipped.`);
          continue;
        }
        const replacement = `<style data-from="${escAttr(href)}">\n${asset.body}\n</style>`;
        html = html.replace(raw, replacement);
        assetsInlined += 1;
      }

      // 5. Inline <script src="..."></script> →
      //    <script>...</script>  (preserve original attributes minus src)
      const scriptRe = /<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*?)>([\s\S]*?)<\/script>/gi;
      const scriptMatches: Array<{ raw: string; before: string; src: string; after: string }> = [];
      for (const m of html.matchAll(scriptRe))
        scriptMatches.push({ raw: m[0], before: m[1] ?? '', src: m[2]!, after: m[3] ?? '' });
      for (const { raw, before, src, after } of scriptMatches) {
        const resolved = resolveRelativePath(input_path, src);
        const asset = await fetchAsset(resolved);
        if (!asset) continue;
        if (asset.kind !== 'text') {
          warnings.push(`Script "${src}" had non-text content-type ${asset.type}; skipped.`);
          continue;
        }
        const attrs = `${before.trim()}${before.trim() && after.trim() ? ' ' : ''}${after.trim()}`.trim();
        const open = attrs ? `<script ${attrs}>` : '<script>';
        const replacement = `${open}\n${asset.body}\n</script>`;
        html = html.replace(raw, replacement);
        assetsInlined += 1;
      }

      // 6. Inline <img src="..."> → <img src="data:...;base64,...">
      const imgRe = /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*?)\/?>/gi;
      const imgMatches: Array<{ raw: string; before: string; src: string; after: string }> = [];
      for (const m of html.matchAll(imgRe))
        imgMatches.push({ raw: m[0], before: m[1] ?? '', src: m[2]!, after: m[3] ?? '' });
      for (const { raw, before, src, after } of imgMatches) {
        if (src.startsWith('data:') || /^[a-z]+:\/\//i.test(src)) continue;
        const resolved = resolveRelativePath(input_path, src);
        const asset = await fetchAsset(resolved);
        if (!asset) continue;
        if (asset.kind !== 'binary') {
          warnings.push(`Image "${src}" returned text content-type ${asset.type}; left as-is.`);
          continue;
        }
        const dataUri = `data:${asset.type};base64,${bytesToBase64(asset.bytes)}`;
        const replacement = `<img${before}src="${dataUri}"${after}>`;
        html = html.replace(raw, replacement);
        assetsInlined += 1;
      }

      // 7. PUT the bundled HTML back to the project.
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

// Suppress unused-warning for FileEntry — kept for future manifest-pre-walk path.
void ({} as FileEntry);
