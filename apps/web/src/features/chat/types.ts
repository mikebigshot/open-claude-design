// Chat panel local types.

export type ChatTab = 'Chat' | 'Comments' | 'Activity';

export interface ChipPrim {
  /** Stable id; used for delete keys. */
  id: string;
  /** Human-readable label, e.g. "Hi-fi design". */
  label: string;
  /** Optional file path / R2 key, populated for upload chips. */
  ref?: string;
}

export interface Pin {
  /** Stable id; used as React key and for delete dispatch. */
  id: string;
  n: number;
  text: string;
  createdAt: string;
  user?: string;
  /** Path of the file the pin was dropped on; used to navigate from CommentsTab. */
  filePath?: string | null;
  /**
   * Optional CSS selector identifying the element the pin points at — same
   * shape as the workspace `CommentPin.selector`. Surfaced here so the
   * multi-select aggregator can include it in the chat message text.
   */
  selector?: string | null;
}

export interface ActivityEntry {
  id: string;
  t: string; // formatted time, e.g. "10:42"
  who: string; // "Atelier" / "im" / username
  what: string;
  color: string; // theme token color
}
