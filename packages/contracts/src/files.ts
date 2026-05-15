// File CRUD contracts. Slice 3 fills out usage; this defines the shape.

export type FileMimeType =
  | 'text/jsx'
  | 'text/javascript'
  | 'text/html'
  | 'text/css'
  | 'image/png'
  | 'image/jpeg'
  | 'image/svg+xml'
  | 'application/json'
  | 'text/plain';

/**
 * Runtime mirror of the FileMimeType union — used by the worker to validate
 * client-supplied Content-Type headers / FileWriteRequest.mimeType before
 * persisting them to D1 (`blobs.mime_type`) + R2 (`httpMetadata.contentType`)
 * and echoing them back on GET. Keeping this list aligned with the union is
 * enforced at compile time by the `satisfies readonly FileMimeType[]` clause.
 *
 * Why an allowlist: without it, a client could send `Content-Type: text/html`
 * with arbitrary HTML bytes and the worker would happily echo it back, opening
 * a stored-XSS path. It also rejects charset suffixes like
 * `image/png; charset=utf-8` whose raw form would break the FileMimeType union
 * downstream consumers depend on (frontend exhaustive switches, FileRecord).
 *
 * Callers are expected to do their own splitting/trimming before checking —
 * this function is pure membership, no normalization.
 */
export const ALLOWED_FILE_MIME_TYPES = [
  'text/jsx',
  'text/javascript',
  'text/html',
  'text/css',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'application/json',
  'text/plain',
] as const satisfies readonly FileMimeType[];

export function isAllowedMime(mime: string): mime is FileMimeType {
  return (ALLOWED_FILE_MIME_TYPES as readonly string[]).includes(mime);
}

export interface FileRecord {
  projectId: string;
  path: string; // e.g. "src/App.jsx" or "tokens.css"
  sha256: string; // content-addressed; storage in R2 at projects/{projectId}/blobs/{sha256}
  size: number;
  mimeType: FileMimeType;
  updatedAt: string;
}

export interface FileWriteRequest {
  path: string;
  content: string; // UTF-8 text; binary uploads use multipart endpoint
  mimeType?: FileMimeType;
  /**
   * When present, the worker will also `upsertAsset` after writing the
   * file row so the project's review manifest reflects this version
   * without a follow-up `register_assets` call. `subtitle` / `viewport`
   * propagate to the same asset row.
   */
  asset?: string;
  subtitle?: string;
  viewport?: { width: number; height?: number };
}

export interface FileWriteResponse {
  path: string;
  sha256: string;
  size: number;
  version: number;
}

export interface ListFilesResponse {
  files: FileRecord[];
}
