// apps/web/src/lib/model-pref-events.ts
//
// localStorage doesn't fire 'storage' events in the same tab (only across tabs).
// We need a custom event so ModelDropdown change → re-create agent in the same
// tab. Across tabs we ALSO listen for the native storage event so a change in
// one tab is reflected in another tab without a manual reload.

import { MODEL_STORAGE_KEY } from './model-pref';

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeModelChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitModelChange(): void {
  for (const fn of listeners) fn();
}

// Cross-tab: native 'storage' event fires in OTHER tabs when localStorage
// changes. Forward to our local listeners so subscribers don't need to know
// about both channels.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === MODEL_STORAGE_KEY) emitModelChange();
  });
}
