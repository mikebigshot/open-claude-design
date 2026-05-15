// local-mounts — File System Access mount registry.
//
// The user mounts a host-side directory via `showDirectoryPicker()`; we
// keep the resulting `FileSystemDirectoryHandle` in module state. Settings
// UI calls `mountDirectoryViaPicker()` to start that flow; the local_*
// tools call `getMountedDirectory()` + `resolveLocalPath()` to walk it.
//
// IndexedDB persistence is intentionally not wired here — the security
// model still requires the user to re-grant permission on each session, so
// surviving a reload buys little UX. If we add it later, write the handle
// under `open-design/local-mounts/active` and call
// `handle.requestPermission()` on first read.

let activeHandle: FileSystemDirectoryHandle | null = null;

/** Test/host hook to set a mount handle. UI calls `mountDirectoryViaPicker`
 *  instead; tests / Node bench may need this raw setter. */
export function _setMountedDirectory(handle: FileSystemDirectoryHandle | null): void {
  activeHandle = handle;
}

export function setMountedDirectory(handle: FileSystemDirectoryHandle | null): void {
  activeHandle = handle;
}

export function hasMountedDirectory(): boolean {
  return activeHandle !== null;
}

export function getMountedDirectory(): FileSystemDirectoryHandle | null {
  return activeHandle;
}

/** Show the directory picker, set the chosen handle as the active mount,
 *  and return it. UI callers should display a button that invokes this. */
export async function mountDirectoryViaPicker(): Promise<FileSystemDirectoryHandle | null> {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  if (!w || typeof w.showDirectoryPicker !== 'function') return null;
  try {
    const picker = w.showDirectoryPicker as () => Promise<FileSystemDirectoryHandle>;
    const handle = await picker();
    activeHandle = handle;
    return handle;
  } catch {
    // User cancelled the picker — leave active mount unchanged.
    return null;
  }
}

/** Drop the active mount (UI "disconnect" affordance). */
export function clearMountedDirectory(): void {
  activeHandle = null;
}

/** Result of resolving a "<mount-relative path>" against the active mount. */
export type LocalResolveResult =
  | { kind: 'file'; handle: FileSystemFileHandle; segments: string[] }
  | { kind: 'directory'; handle: FileSystemDirectoryHandle; segments: string[] }
  | { kind: 'not_found'; segments: string[] };

/**
 * Walk `relPath` (slash-separated, leading slash optional) against `root`.
 * Returns the deepest resolved handle plus its kind. `not_found` carries
 * the segments so the caller can produce a precise error message.
 *
 * An empty `relPath` resolves to the root directory itself.
 */
export async function resolveLocalPath(
  root: FileSystemDirectoryHandle,
  relPath: string,
): Promise<LocalResolveResult> {
  const segments = relPath
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.');
  if (segments.length === 0) {
    return { kind: 'directory', handle: root, segments: [] };
  }
  let cursor: FileSystemDirectoryHandle = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]!;
    try {
      cursor = await cursor.getDirectoryHandle(seg);
    } catch {
      return { kind: 'not_found', segments: segments.slice(0, i + 1) };
    }
  }
  const last = segments[segments.length - 1]!;
  try {
    const fileHandle = await cursor.getFileHandle(last);
    return { kind: 'file', handle: fileHandle, segments };
  } catch {
    // Not a file — try as directory.
  }
  try {
    const dirHandle = await cursor.getDirectoryHandle(last);
    return { kind: 'directory', handle: dirHandle, segments };
  } catch {
    return { kind: 'not_found', segments };
  }
}
