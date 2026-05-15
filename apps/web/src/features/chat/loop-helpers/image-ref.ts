// `__image_ref` protocol detector + AI-SDK image-content adapter.
//
// W2's screenshot tool returns `{__image_ref: true, path}` (single) or an
// array of such refs (multi_screenshot). The dispatcher / wrapper layer
// (agent.ts wrapper, applied per W1 §2.7) detects this shape and feeds the
// LLM image content blocks rather than stringified JSON, so the LLM can
// actually "see" the screenshot in its context.
//
// We deliberately keep the AI-SDK content shape generic (string `image:`
// field) since AI SDK 6 accepts both string URLs / data URLs and
// `URL`/`Uint8Array` for image parts.

export const IMAGE_REF_KEY = '__image_ref' as const;

/** A single image_ref descriptor as returned by tools like `screenshot`. */
export interface ImageRef {
  readonly __image_ref: true;
  readonly path: string;
}

export function isImageRef(value: unknown): value is ImageRef {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v[IMAGE_REF_KEY] === true && typeof v.path === 'string';
}

/**
 * Extract the `path` field(s) from a single ref or a homogeneous array of
 * refs. Returns `[]` when the value isn't an image_ref or when an array is
 * heterogeneous (mixed refs + non-refs) — the dispatcher should fall back to
 * regular stringified handling in that case.
 */
export function extractImageRefs(value: unknown): string[] {
  if (isImageRef(value)) return [value.path];
  if (Array.isArray(value) && value.length > 0 && value.every(isImageRef)) {
    return value.map((ref) => ref.path);
  }
  return [];
}

/**
 * Map extracted image-paths into AI-SDK content-block shape so they can be
 * stuffed into a tool_result `output` or a user message `content`.
 */
export function toImageContent(paths: readonly string[]): Array<{ type: 'image'; image: string }> {
  return paths.map((path) => ({ type: 'image' as const, image: path }));
}
