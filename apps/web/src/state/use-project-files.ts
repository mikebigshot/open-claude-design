// useProjectFiles — shared, dedup'd loader for "all files in this project".
//
// Before this hoist, PreviewPanel / FileTree / FilePreviewPane each fired
// their own GET /api/projects/<id>/files + N GET /files/<path> waterfall on
// every mount. Cross-component navigation thus re-fetched everything.
//
// This module-level cache keys the loaded snapshot by `<projectId>::<changedAt>`
// — the `filesChangedAt` reducer tick is bumped any time the agent writes /
// deletes / copies a file, so the cache invalidates exactly when content
// could have changed. In-flight requests are also deduped via a parallel
// promise map (two components mounting at once → one network call).
//
// The hook returns `{ files, loadError }` directly so callers can map the
// snapshot into whatever shape they need (FileTree wants names only;
// PreviewPanel wants the content body for srcdoc bundling).

import { useEffect, useState } from 'react';
import { api } from '@/lib/api.js';

export interface ProjectFile {
  path: string;
  mimeType: string;
  content: string;
}

interface ListFilesResponse {
  files: Array<{ path: string; mimeType: string }>;
}

const cache = new Map<string, ProjectFile[]>();
const inflight = new Map<string, Promise<ProjectFile[]>>();

function cacheKey(projectId: string, changedAt: number | string): string {
  return `${projectId}::${changedAt}`;
}

/** Test-only: clear the module-level cache. */
export function _resetProjectFilesCache(): void {
  cache.clear();
  inflight.clear();
}

async function loadProjectFiles(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectFile[]> {
  const list = await api<ListFilesResponse>(`/api/projects/${encodeURIComponent(projectId)}/files`);
  const fetched = await Promise.all(
    list.files.map(async (record) => {
      const content = await api<string>(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(record.path)}`,
        { expectText: true },
      );
      void signal;
      return {
        path: record.path,
        mimeType: record.mimeType,
        content: typeof content === 'string' ? content : JSON.stringify(content),
      } satisfies ProjectFile;
    }),
  );
  return fetched;
}

/**
 * Subscribe to the current project's file snapshot. `changedAt` is the
 * reducer tick (or any sentinel that bumps when files mutate) used as the
 * cache key — pass `state.filesChangedAt` from `useWorkspace()`.
 *
 * - First mount with a fresh `changedAt`: kicks one fetch; concurrent
 *   mounts piggy-back on the same Promise (no duplicate network calls).
 * - Subsequent mounts with the same `changedAt`: synchronous cache hit.
 * - When `changedAt` advances, the old cache entry is left in place
 *   (different key) and a fresh fetch fires; consumers re-render once the
 *   new snapshot arrives.
 */
export function useProjectFiles(
  projectId: string | null | undefined,
  changedAt: number | string,
): { files: ProjectFile[]; loadError: string | null } {
  const [, forceRerender] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setLoadError(null);
      return;
    }
    const key = cacheKey(projectId, changedAt);
    if (cache.has(key)) {
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    let p = inflight.get(key);
    if (!p) {
      p = loadProjectFiles(projectId).then((fetched) => {
        cache.set(key, fetched);
        inflight.delete(key);
        return fetched;
      });
      inflight.set(key, p);
    }
    p.then(() => {
      if (!cancelled) forceRerender((n) => n + 1);
    }).catch((err) => {
      inflight.delete(key);
      if (!cancelled) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, changedAt]);

  const files = projectId ? cache.get(cacheKey(projectId, changedAt)) ?? [] : [];
  return { files, loadError };
}
