// Assets — register_assets manifest wire format.
//
// `register_assets` registers files as versions of a named asset (Type / Colors
// / Spacing / Components / Brand). Re-registering the same (asset, path) pair
// resets the row's review status. Used by the Design System tab.
//
// Persistence end points (apps/api/src/routes/assets.ts):
//   POST  /api/projects/:id/assets   RegisterAssets (body: { items })
//   GET   /api/projects/:id/assets   ListAssets

export type AssetStatus = 'needs-review' | 'approved' | 'changes-requested';

export interface AssetViewport {
  width: number;
  height?: number;
}

/** A single asset entry as the agent sends it (input payload). */
export interface AssetRegistration {
  /** Asset name (label). */
  asset: string;
  /** File path relative to project root. */
  path: string;
  /** Short description of this version. */
  subtitle?: string;
  viewport?: AssetViewport;
  status?: AssetStatus;
  /**
   * Section this card belongs to in the Design System tab. Title-cased.
   * Common values: "Type" | "Colors" | "Spacing" | "Components" | "Brand".
   */
  group?: string;
}

/** Persisted row, returned from the server. */
export interface RegisteredAsset {
  id: string;
  projectId: string;
  asset: string;
  path: string;
  subtitle: string | null;
  viewport: AssetViewport | null;
  status: AssetStatus;
  group: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterAssetsRequest {
  items: AssetRegistration[];
}

export interface RegisterAssetsResponse {
  registered: RegisteredAsset[];
}

export interface ListAssetsResponse {
  assets: RegisteredAsset[];
}
