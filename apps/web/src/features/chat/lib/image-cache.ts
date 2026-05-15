// image-cache — bounded LRU keyed by sha256 (or any string). The view_image
// tool runs each unique image through canvas decode + downsize + JPEG
// re-encode ONCE per session; the cache lets the repeated turn-by-turn
// re-emission of the same image content block hit the cache instead of
// re-decoding 200 KB → 8 MB → 2 MB on every step.
//
// Pure JS; no browser APIs touched here. The decode/resize/encode pipeline
// lives in view-image.ts; this module only stores the resulting bytes.

const DEFAULT_CAPACITY = 30;

export interface CachedImage {
  /** Base64-encoded JPEG body (no `data:` prefix). */
  base64: string;
  /** `image/jpeg` or whatever the encoder produced. */
  mediaType: string;
  /** Original size in bytes (for budgeting / telemetry). */
  originalBytes: number;
  /** Cached (re-encoded) size in bytes. */
  encodedBytes: number;
}

/**
 * Bounded LRU. Map's insertion-order iteration is the LRU semantics:
 * `set` on an existing key first deletes-then-reinserts to push to the
 * tail; `get` does the same to mark as recently used.
 */
export class ImageCache {
  private readonly capacity: number;
  private readonly store = new Map<string, CachedImage>();

  constructor(capacity = DEFAULT_CAPACITY) {
    if (capacity < 1) throw new Error('ImageCache capacity must be >= 1');
    this.capacity = capacity;
  }

  size(): number {
    return this.store.size;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  get(key: string): CachedImage | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    // Refresh recency: re-insert at tail.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  set(key: string, value: CachedImage): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Evict the least-recently-used (head of iteration).
      const head = this.store.keys().next().value;
      if (head !== undefined) this.store.delete(head);
    }
    this.store.set(key, value);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Test-only hook. Wipes the store. */
  _reset(): void {
    this.store.clear();
  }

  /** Inspect current key order (oldest-first → newest-last). Test-only. */
  _keys(): string[] {
    return Array.from(this.store.keys());
  }
}

/** Module-level singleton used by view_image. */
let _viewImageCache: ImageCache | null = null;

export function getViewImageCache(): ImageCache {
  if (!_viewImageCache) _viewImageCache = new ImageCache();
  return _viewImageCache;
}

/** Test-only hook for isolating tests from the module-level singleton. */
export function _resetViewImageCache(): void {
  _viewImageCache = null;
}
