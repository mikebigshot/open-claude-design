// IframeBridge — typed wrapper around postMessage to/from the preview iframe.
//
// Wire shape: see `packages/iframe-runtime/src/editmode-protocol.ts` for the
// full ParentToIframe / IframeToParent unions. Two protocol families coexist:
//
//   1. overlay protocol — carries `__codesign: true` envelope. Used
//      for SET_MODE / EDIT_STYLE / CLEAR_PIN / OVERLAY_READY / ELEMENT_SELECTED
//      / IFRAME_ERROR. The iframe runtime attaches/strips the envelope; on the
//      parent side we add it on send, and the receive listener checks for it.
//
//   2. tweaks protocol — bare messages without envelope. Used for
//      __activate_edit_mode / __deactivate_edit_mode / __edit_mode_available
//      / __edit_mode_set_keys. These are emitted/handled by the artifact's
//      own React code (Tweaks UI), not the OVERLAY_SCRIPT.
//
// The bridge transparently routes outgoing messages: messages whose `type`
// starts with `__` go without envelope; everything else gets `__codesign:
// true`. Incoming messages dispatch by `type` regardless of envelope.

import type { IframeToParent, ParentToIframe } from '@open-design/iframe-runtime';

type MessageType = IframeToParent['type'];
type MessageOf<T extends MessageType> = Extract<IframeToParent, { type: T }>;
type Handler<T extends MessageType> = (msg: MessageOf<T>) => void;
// Internal storage erases the discriminant — handlers go through a runtime
// type check before being invoked, so the cast is safe but TS would
// otherwise complain about Handler<T> ↔ Handler<MessageType> variance.
type AnyHandler = (msg: IframeToParent) => void;

/**
 * Type-safe parent-side bridge. Construct once per iframe lifetime; call
 * `off()` on unmount to drop all listeners.
 */
export class IframeBridge {
  private readonly iframe: HTMLIFrameElement;
  private readonly handlers = new Map<MessageType, Set<AnyHandler>>();
  private readonly windowListener: (event: MessageEvent) => void;
  private disposed = false;

  constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
    this.windowListener = (event) => this.onWindowMessage(event);
    window.addEventListener('message', this.windowListener);
  }

  /**
   * Send a typed message to the iframe. Envelope (`__codesign: true`) is
   * attached automatically for non-`__`-prefixed types so you don't need to
   * remember which family each message belongs to.
   */
  send(msg: ParentToIframe): void {
    if (this.disposed) return;
    const target = this.iframe.contentWindow;
    if (!target) return;

    const isTweakMessage = msg.type.startsWith('__');
    const payload = isTweakMessage ? msg : { __codesign: true, ...msg };

    try {
      target.postMessage(payload, '*');
    } catch (err) {
      // postMessage can throw on detached iframes; log & swallow so callers
      // don't have to handle every send().
      console.warn('[iframe-bridge] postMessage failed:', err);
    }
  }

  /**
   * Subscribe to messages of a specific type. Returns an unsubscribe function.
   */
  on<T extends MessageType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped = handler as unknown as AnyHandler;
    set.add(wrapped);
    return () => {
      const current = this.handlers.get(type);
      if (!current) return;
      current.delete(wrapped);
      if (current.size === 0) this.handlers.delete(type);
    };
  }

  /** Drop all listeners and detach from the global message bus. */
  off(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('message', this.windowListener);
    this.handlers.clear();
  }

  private onWindowMessage(event: MessageEvent): void {
    if (this.disposed) return;
    const sourceWindow = this.iframe.contentWindow;
    // Drop messages from windows other than our iframe.
    if (sourceWindow && event.source !== sourceWindow) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    const candidate = data as { type?: unknown };
    if (typeof candidate.type !== 'string') return;

    const type = candidate.type as MessageType;
    const handlers = this.handlers.get(type);
    if (!handlers || handlers.size === 0) return;

    // We trust the iframe to send well-formed messages; cast straight.
    const msg = data as IframeToParent;
    handlers.forEach((handler) => {
      try {
        handler(msg);
      } catch (err) {
        console.warn('[iframe-bridge] handler threw for type', type, err);
      }
    });
  }
}
