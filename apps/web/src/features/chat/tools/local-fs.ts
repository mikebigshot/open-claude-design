// local_* tools — File System Access bridge.
//
// The user mounts a host-side directory via the File System Access API
// (`showDirectoryPicker`); the resulting handle is held in `lib/local-mounts`.
// These tools walk the mount via `resolveLocalPath` and stream bytes back to
// the agent. No network round-trip on the read path — the only network call
// is `local_copy_to_project` (PUT to worker /files/<dest>).

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';
import {
  getMountedDirectory,
  hasMountedDirectory,
  resolveLocalPath,
} from '@/lib/local-mounts.js';

const NOT_SUPPORTED =
  'Local file system access requires the File System Access API (Chrome / Edge / Opera). Safari and Firefox do not support it; ask the user to upload a zip instead.';
const NO_MOUNT =
  'No local directory mounted. Ask the user to grant access to a host folder via the workspace settings before calling local_* tools.';

function preflight(): string | null {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  if (!w || typeof w.showDirectoryPicker !== 'function') {
    return `Error: ${NOT_SUPPORTED}`;
  }
  if (!hasMountedDirectory()) {
    return `Error: ${NO_MOUNT}`;
  }
  return null;
}

const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_GREP_TOTAL_HITS = 200;
const BINARY_EXT_RE = /\.(?:png|jpe?g|gif|webp|ico|pdf|zip|tar|gz|bz2|xz|woff2?|ttf|otf|eot|mp[34]|wav|webm|mov|avi)$/i;

/** Iterate over a directory handle's entries (cross-version typing). */
async function entriesOf(
  dir: FileSystemDirectoryHandle,
): Promise<Array<[string, FileSystemHandle]>> {
  const out: Array<[string, FileSystemHandle]> = [];
  // The standard `entries()` is async-iterable; jsdom doesn't ship it so the
  // fake handles used in tests expose a non-standard `_entries` array.
  const maybe = dir as unknown as {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    _entries?: Array<[string, FileSystemHandle]>;
  };
  if (typeof maybe.entries === 'function') {
    for await (const e of maybe.entries()) out.push(e);
    return out;
  }
  if (Array.isArray(maybe._entries)) return maybe._entries.slice();
  return out;
}

export function localLsTool() {
  return tool({
    description:
      'List entries in a mounted local directory. Pass an empty path to list the mount root.',
    inputSchema: z
      .object({
        path: z.string().optional().describe('Relative path within the mounted directory.'),
      })
      .strict(),
    execute: async ({ path }) => {
      const err = preflight();
      if (err) return err;
      const root = getMountedDirectory()!;
      const resolved = await resolveLocalPath(root, path ?? '');
      if (resolved.kind === 'not_found') {
        return `Error: path not found in mount: ${resolved.segments.join('/')}`;
      }
      if (resolved.kind !== 'directory') {
        return `Error: path is a file, not a directory: ${resolved.segments.join('/')}`;
      }
      const entries = await entriesOf(resolved.handle);
      if (entries.length === 0) return '(empty)';
      const lines: string[] = [];
      for (const [name, handle] of entries) {
        const isDir = (handle as { kind?: string }).kind === 'directory';
        lines.push(isDir ? `📁 ${name}/` : `📄 ${name}`);
      }
      return lines.join('\n');
    },
  });
}

export function localReadTool() {
  return tool({
    description: 'Read a file from a mounted local directory as UTF-8 text.',
    inputSchema: z
      .object({
        path: z.string().min(1).describe('Path within the mounted directory.'),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).optional(),
      })
      .strict(),
    execute: async ({ path, offset, limit }) => {
      const err = preflight();
      if (err) return err;
      const root = getMountedDirectory()!;
      const resolved = await resolveLocalPath(root, path);
      if (resolved.kind === 'not_found') return `Error: file not found: ${path}`;
      if (resolved.kind !== 'file') return `Error: path is a directory, not a file: ${path}`;
      const file = await resolved.handle.getFile();
      const text = await file.text();
      const lines = text.split('\n');
      const start = offset ?? 0;
      const end = limit !== undefined ? start + limit : lines.length;
      const slice = lines.slice(start, end);
      let header = `[Local: ${path}]\n`;
      if (start === 0 && end >= lines.length) {
        header += `[${lines.length} lines, ${text.length} chars — showing all]\n\n`;
      } else {
        header += `[${lines.length} lines total — showing lines ${start + 1}-${start + slice.length}]\n\n`;
      }
      return header + slice.join('\n');
    },
  });
}

export function localGrepTool() {
  return tool({
    description:
      'Regex search across files in a mounted local directory. Skips files >2 MiB and binary types.',
    inputSchema: z
      .object({
        pattern: z.string().min(1).describe('Regex pattern.'),
        path: z.string().optional().describe('Limit to a sub-path within the mount.'),
      })
      .strict(),
    execute: async ({ pattern, path }) => {
      const err = preflight();
      if (err) return err;
      const root = getMountedDirectory()!;
      const start = await resolveLocalPath(root, path ?? '');
      if (start.kind === 'not_found') return `Error: path not found in mount: ${path}`;
      if (start.kind !== 'directory') return `Error: grep root must be a directory: ${path}`;
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (e) {
        return `Error: invalid regex (${e instanceof Error ? e.message : 'unknown'})`;
      }
      const hits: Array<{ path: string; line: number; text: string }> = [];
      async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
        if (hits.length >= MAX_GREP_TOTAL_HITS) return;
        const entries = await entriesOf(dir);
        for (const [name, handle] of entries) {
          if (hits.length >= MAX_GREP_TOTAL_HITS) return;
          const childPath = prefix ? `${prefix}/${name}` : name;
          const kind = (handle as { kind?: string }).kind;
          if (kind === 'directory') {
            await walk(handle as FileSystemDirectoryHandle, childPath);
            continue;
          }
          if (kind !== 'file') continue;
          if (BINARY_EXT_RE.test(name)) continue;
          const fh = handle as FileSystemFileHandle;
          const file = await fh.getFile();
          if (file.size > MAX_GREP_FILE_BYTES) continue;
          const text = await file.text();
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i += 1) {
            if (regex.test(lines[i]!)) {
              hits.push({ path: childPath, line: i + 1, text: lines[i]! });
              if (hits.length >= MAX_GREP_TOTAL_HITS) return;
            }
          }
        }
      }
      await walk(start.handle, path ?? '');
      if (hits.length === 0) return `No matches for /${pattern}/ in mount.`;
      return hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n');
    },
  });
}

export function localCopyToProjectTool(projectId: string) {
  return tool({
    description:
      "Copy a file from a mounted local directory into the current project. The project keeps the bytes; the source on disk is unchanged.",
    inputSchema: z
      .object({
        from: z.string().min(1).describe('Path within the mounted directory.'),
        to: z.string().min(1).describe('Destination path inside the project.'),
      })
      .strict(),
    execute: async ({ from, to }, ctx) => {
      const abortSignal = ctx?.abortSignal;
      const err = preflight();
      if (err) return err;
      const root = getMountedDirectory()!;
      const resolved = await resolveLocalPath(root, from);
      if (resolved.kind === 'not_found') return `Error: source file not found in mount: ${from}`;
      if (resolved.kind !== 'file') return `Error: source path is a directory, not a file: ${from}`;
      const file = await resolved.handle.getFile();
      const body = await file.arrayBuffer();
      const mime = file.type || 'application/octet-stream';
      const url = buildUrl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(to.replace(/^\/+/, ''))}`,
      );
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': mime },
          body,
          signal: abortSignal,
        });
      } catch (e) {
        return `Error: PUT ${to} failed (${e instanceof Error ? e.message : 'unknown'})`;
      }
      if (!res.ok) return `Error: PUT ${to} failed (HTTP ${res.status})`;
      return `Copied ${from} → ${to} (${file.size} bytes)`;
    },
  });
}
