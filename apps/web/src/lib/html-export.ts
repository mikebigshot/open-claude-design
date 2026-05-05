// html-export — bundle the live project files into a single self-contained HTML.
//
// Slice 9 deliverable. We piggy-back on the iframe-runtime's `buildSrcdoc` so
// the offline export and the in-app preview render the same way (same Babel
// transform, same overlay-less HTML shell). To keep the file self-contained
// while staying small enough to email around, we *inline* every project file
// content but still pull React + Babel Standalone from unpkg via the same
// CDN URLs the in-app preview uses (a few MB cached by the browser).
//
// The runtime helper `buildSrcdoc` is implemented in `packages/iframe-runtime`
// (see slice 3 plan). When it lands, this module simply imports it. Until
// then we resolve it lazily so this module stays type-clean even if the
// helper hasn't shipped yet.
//
// Output: a `Blob` of `text/html`. Caller chooses how to surface it — the
// `SharePopover` builds an object URL and triggers a download.

import { api } from './api';
import { buildSrcdoc, type BundleFile } from '@open-design/iframe-runtime/build-srcdoc';
import {
  buildHtmlSrcdoc,
  isHtmlOnlyBundle,
  pickHtmlEntry,
} from '@open-design/iframe-runtime/build-html-srcdoc';
import type { FileRecord, ListFilesResponse } from '@open-design/contracts';

interface InlineFile {
  path: string;
  mimeType: string;
  content: string;
}

/**
 * Fetch all files for a project and produce a single, offline-friendly HTML
 * document. React + Babel Standalone are fetched from unpkg by the inline
 * runtime — the file is small but requires network the first time it loads.
 */
export async function exportAsStandaloneHtml(projectId: string): Promise<Blob> {
  const list = await api<ListFilesResponse>(`/api/projects/${encodeURIComponent(projectId)}/files`);
  const files = await fetchAllFiles(projectId, list.files);

  // Use the canonical helper from the runtime package so the offline export
  // matches the in-app preview byte-for-byte. If buildSrcdoc throws (e.g. on
  // a malformed bundle), fall back to a structured listing so users still
  // get something useful.
  // HTML-only artifacts skip Babel: agent's <!DOCTYPE> would crash JSX parser.
  let html: string;
  try {
    if (isHtmlOnlyBundle(files)) {
      const entry = pickHtmlEntry(files);
      html = entry
        ? buildHtmlSrcdoc(entry.content, { injectOverlay: false })
        : renderFallbackShell(files);
    } else {
      const bundle: BundleFile[] = files.map((f) => ({
        path: f.path,
        content: f.content,
        mimeType: f.mimeType,
      }));
      html = buildSrcdoc(bundle, { injectOverlay: false, injectTweaks: false });
    }
  } catch {
    html = renderFallbackShell(files);
  }

  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

async function fetchAllFiles(projectId: string, records: FileRecord[]): Promise<InlineFile[]> {
  // P1-9 fix: read file content as raw text via `expectText: true`. Without
  // this flag api() auto-parses any `application/json` response (e.g.
  // `.json` source files served by the worker with content-type:
  // application/json) into an object — which we'd then re-stringify and
  // silently lose the original indentation, key order, and trailing newline.
  const results = await Promise.all(
    records.map(async (record) => {
      const text = await api<string>(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(record.path)}`,
        { expectText: true },
      );
      return {
        path: record.path,
        mimeType: record.mimeType,
        content: text,
      } satisfies InlineFile;
    }),
  );
  return results;
}

/**
 * Tiny self-contained shell for the case where the runtime helper isn't
 * available yet. Renders the first .html (or the entry `index.html`) inline
 * and otherwise lists the files with their content inside <pre>. Good enough
 * to confirm the export pipeline works end-to-end before slice 3 lands.
 */
function renderFallbackShell(files: InlineFile[]): string {
  const indexFile =
    files.find((f) => f.path.toLowerCase() === 'index.html') ??
    files.find((f) => f.path.toLowerCase().endsWith('.html'));

  const styleBlocks = files
    .filter((f) => f.mimeType === 'text/css' || f.path.toLowerCase().endsWith('.css'))
    .map((f) => `<style data-path="${escapeHtml(f.path)}">${f.content}</style>`)
    .join('\n');

  const indexBody = indexFile ? extractBody(indexFile.content) : null;

  const fileManifest = files
    .map(
      (f) =>
        `<details><summary>${escapeHtml(f.path)} <code>${escapeHtml(f.mimeType)}</code></summary><pre>${escapeHtml(f.content)}</pre></details>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Open Design — Standalone Export</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 0; background: #FAF9F5; color: #141413; }
      .wrap { max-width: 920px; margin: 0 auto; padding: 28px; }
      details { background: #FCFBF8; border: 1px solid #DDD8C8; border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
      summary { cursor: pointer; font-weight: 500; }
      pre { background: #fff; border: 1px solid #ECE9DF; border-radius: 6px; padding: 12px; overflow: auto; }
      code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: #5A574F; }
    </style>
    ${styleBlocks}
  </head>
  <body>
    ${indexBody ? indexBody : `<div class="wrap"><h1>Open Design Export</h1><p>Standalone export — files below.</p>${fileManifest}</div>`}
  </body>
</html>`;
}

function extractBody(html: string): string | null {
  const match = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return match ? (match[1] ?? null) : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
