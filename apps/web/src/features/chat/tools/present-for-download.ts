// present_fs_item_for_download — fetches a project file (or zips a folder /
// the whole project) and triggers a browser download. Mirrors v2 official
// tool name and input schema; the execution model differs (we run client-side
// in a single shot instead of presenting a re-clickable card in chat history).
//
// Dependencies are DI-able for tests:
//   - fetchImpl     : alternate fetch (defaults to global fetch)
//   - triggerDownload : how to deliver the Blob to the user
//                       (defaults to a synthetic <a download> click)
//   - zipFolder     : how to zip multiple files
//                       (defaults to a lazy-loaded JSZip wrapper)
//
// The tool returns metadata describing what was downloaded so the agent can
// reason about the next turn ("file downloaded, ask if user wants follow-up").

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

type Input = { path?: string; label?: string; origin?: string };

interface FileEntry {
  path: string;
  size?: number;
  mimeType?: string;
  mediaType?: string;
  updatedAt?: string;
}

type Output =
  | { ok: true; kind: 'file' | 'folder' | 'project'; path: string; label: string; bytes: number }
  | { ok: false; error: 'invalid_path'; message: string }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'fetch_failed'; message: string };

export interface PresentForDownloadDeps {
  fetchImpl?: typeof fetch;
  triggerDownload?: (blob: Blob, filename: string) => void;
  zipFolder?: (files: Record<string, Uint8Array>) => Promise<Blob>;
}

/**
 * Default browser-side trigger — appends a hidden <a download> to the DOM,
 * clicks it, then releases the object URL. Works in JSDOM via DI override.
 */
function defaultTriggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke a tick so Chrome has actually started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function defaultZipFolder(files: Record<string, Uint8Array>): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [path, bytes] of Object.entries(files)) {
    zip.file(path, bytes);
  }
  return zip.generateAsync({ type: 'blob' });
}

function basename(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] ?? path;
}

export function presentFsItemForDownloadTool(projectId: string, deps?: PresentForDownloadDeps) {
  const fetchImpl: typeof fetch = deps?.fetchImpl ?? ((...a) => fetch(...a));
  const triggerDownload = deps?.triggerDownload ?? defaultTriggerDownload;
  const zipFolder = deps?.zipFolder ?? defaultZipFolder;

  return tool<Input, Output>({
    description:
      'Present a file, folder, or the whole project as a downloadable file to the user. A browser download is triggered. If the path is a folder (or omitted), the items are zipped first.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe('Folder or file path relative to project root. Omit or "" for the whole project.'),
      label: z.string().optional().describe('Display label for the download (defaults to item name).'),
      origin: z
        .string()
        .optional()
        .describe(
          'Optional telemetry tag naming the export flow that produced this download (e.g. "canva_fallback").',
        ),
    }),
    execute: async ({ path, label }, ctx) => {
      const abortSignal = ctx?.abortSignal;
      const rawPath = (path ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
      const listUrl = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files`);

      let listRes: Response;
      try {
        listRes = await fetchImpl(listUrl, { method: 'GET', signal: abortSignal });
      } catch (e) {
        return {
          ok: false,
          error: 'fetch_failed',
          message: `Failed to list project files: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
      if (listRes.status === 404 || !listRes.ok) {
        return { ok: false, error: 'not_found', message: 'Project files not found.' };
      }
      const listed = (await listRes.json()) as { files: FileEntry[] };
      const allFiles = listed.files ?? [];

      // Resolve which files to include.
      let matches: FileEntry[];
      let kind: 'file' | 'folder' | 'project';
      if (rawPath === '') {
        matches = allFiles;
        kind = 'project';
      } else {
        const exact = allFiles.find((f) => f.path === rawPath);
        if (exact) {
          matches = [exact];
          kind = 'file';
        } else {
          const prefix = rawPath + '/';
          matches = allFiles.filter((f) => f.path.startsWith(prefix));
          kind = 'folder';
        }
      }
      if (matches.length === 0) {
        return {
          ok: false,
          error: 'not_found',
          message: `No files matched path "${rawPath}".`,
        };
      }

      // Fetch each file's bytes.
      const fetched: Array<{ path: string; bytes: Uint8Array }> = [];
      for (const f of matches) {
        const fileUrl = buildUrl(
          `/api/projects/${encodeURIComponent(projectId)}/files/${f.path
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/')}`,
        );
        let r: Response;
        try {
          r = await fetchImpl(fileUrl, { method: 'GET', signal: abortSignal });
        } catch (e) {
          return {
            ok: false,
            error: 'fetch_failed',
            message: `Failed to fetch ${f.path}: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
        if (!r.ok) {
          return {
            ok: false,
            error: 'fetch_failed',
            message: `Failed to fetch ${f.path}: HTTP ${r.status}`,
          };
        }
        fetched.push({ path: f.path, bytes: new Uint8Array(await r.arrayBuffer()) });
      }

      if (kind === 'file') {
        const file = fetched[0]!;
        // Copy into a plain ArrayBuffer so TS doesn't widen to SharedArrayBuffer.
        const blobPart = new Uint8Array(file.bytes).buffer as ArrayBuffer;
        const blob = new Blob([blobPart], {
          type: matches[0]?.mediaType || matches[0]?.mimeType || 'application/octet-stream',
        });
        const filename = basename(file.path);
        triggerDownload(blob, filename);
        return {
          ok: true,
          kind: 'file',
          path: file.path,
          label: label ?? filename,
          bytes: file.bytes.length,
        };
      }

      // Folder / project → zip.
      // Strip the folder prefix so the archive root is the folder itself.
      const prefixToStrip = kind === 'folder' ? rawPath + '/' : '';
      const fileMap: Record<string, Uint8Array> = {};
      for (const f of fetched) {
        const rel = f.path.startsWith(prefixToStrip) ? f.path.slice(prefixToStrip.length) : f.path;
        fileMap[rel] = f.bytes;
      }
      const zipBlob = await zipFolder(fileMap);
      const stem = kind === 'project' ? projectId : basename(rawPath);
      const filename = `${stem}.zip`;
      triggerDownload(zipBlob, filename);
      return {
        ok: true,
        kind,
        path: rawPath,
        label: label ?? stem,
        bytes: zipBlob.size,
      };
    },
  });
}
