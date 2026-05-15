// screenshot-pool — process-wide map of in-memory screenshot captures, keyed
// by a caller-supplied string. Shared between save_screenshot (writer) and
// view_image / run_script (readers).
//
// save_screenshot's `in_memory_png_key` mode used to stash only at
// `window.__captures[key]` (Blob[]). That worked for run_script's
// `getCaptures(key)` helper but was invisible to view_image, so the agent
// couldn't view its own captures without an explicit disk save.
//
// This module is the canonical pool. `window.__captures` is now a
// surface-level alias maintained by save_screenshot for run_script
// compatibility; new readers should call `getScreenshotCapture()` directly.

export interface PoolEntry {
  blobs: Blob[];
  /** Process-time of write (ms). Cheap LRU hint; could be wired to a real
   *  eviction policy if the agent starts blowing through memory. */
  writtenAt: number;
}

const pool = new Map<string, PoolEntry>();

/** Test-only: wipe the pool. */
export function _resetScreenshotPool(): void {
  pool.clear();
}

export function setScreenshotCaptures(key: string, blobs: Blob[]): void {
  pool.set(key, { blobs, writtenAt: Date.now() });
}

/** All blobs registered under `key`, or `null` if the key doesn't exist. */
export function getScreenshotCaptures(key: string): Blob[] | null {
  const entry = pool.get(key);
  return entry ? entry.blobs.slice() : null;
}

/** Blob at `index` (0-based) of `key`, or `null` if missing. */
export function getScreenshotCapture(key: string, index = 0): Blob | null {
  const entry = pool.get(key);
  if (!entry) return null;
  return entry.blobs[index] ?? null;
}

/** Count of captures under `key`, or 0 if missing. */
export function getScreenshotCaptureCount(key: string): number {
  return pool.get(key)?.blobs.length ?? 0;
}

/** Enumerate all keys in the pool (writtenAt-ascending). */
export function listScreenshotKeys(): string[] {
  return Array.from(pool.entries())
    .sort((a, b) => a[1].writtenAt - b[1].writtenAt)
    .map(([k]) => k);
}
