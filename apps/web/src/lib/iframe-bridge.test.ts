// IframeBridge unit tests — runs in jsdom (apps/web vitest config).
//
// We verify two paths:
//   - send() forwards to iframe.contentWindow.postMessage, attaching the
//     `__codesign: true` envelope for non-`__` types and leaving tweak
//     messages bare.
//   - on() invokes the handler when window receives a matching `message`
//     event whose `source` matches the iframe's contentWindow, and the
//     unsubscribe function detaches it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { IframeBridge } from './iframe-bridge';

interface MockContentWindow {
  postMessage: (msg: unknown, target: string) => void;
}

const stubsToRestore: Array<() => void> = [];

afterEach(() => {
  // Restore original contentWindow descriptors so jsdom's window teardown
  // (which iterates frames and calls `.close()`) can run cleanly.
  while (stubsToRestore.length > 0) {
    const restore = stubsToRestore.pop();
    restore?.();
  }
});

function makeIframeStub(): {
  iframe: HTMLIFrameElement;
  contentWindow: MockContentWindow & { __spy: ReturnType<typeof vi.fn> };
} {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const spy = vi.fn();
  const fakeWindow = { postMessage: spy, __spy: spy } satisfies MockContentWindow & {
    __spy: ReturnType<typeof vi.fn>;
  };
  // Save original descriptor so we can restore on teardown — otherwise jsdom
  // tries to .close() our plain object on env teardown and crashes.
  const originalDescriptor = Object.getOwnPropertyDescriptor(iframe, 'contentWindow');
  Object.defineProperty(iframe, 'contentWindow', {
    value: fakeWindow,
    configurable: true,
  });
  stubsToRestore.push(() => {
    if (originalDescriptor) {
      Object.defineProperty(iframe, 'contentWindow', originalDescriptor);
    } else {
      // No own descriptor; remove the override so jsdom's prototype getter
      // takes over again.
      Reflect.deleteProperty(iframe, 'contentWindow');
    }
    iframe.remove();
  });
  return { iframe, contentWindow: fakeWindow };
}

describe('IframeBridge', () => {
  it('attaches __codesign envelope for codesign protocol messages', () => {
    const { iframe, contentWindow } = makeIframeStub();
    const bridge = new IframeBridge(iframe);

    bridge.send({ type: 'SET_MODE', mode: 'edit' });

    expect(contentWindow.__spy).toHaveBeenCalledTimes(1);
    const [msg, target] = contentWindow.__spy.mock.calls[0]!;
    expect(target).toBe('*');
    expect(msg).toMatchObject({
      __codesign: true,
      type: 'SET_MODE',
      mode: 'edit',
    });

    bridge.off();
  });

  it('sends tweak protocol messages without envelope', () => {
    const { iframe, contentWindow } = makeIframeStub();
    const bridge = new IframeBridge(iframe);

    bridge.send({ type: '__activate_edit_mode' });

    expect(contentWindow.__spy).toHaveBeenCalledTimes(1);
    const [msg] = contentWindow.__spy.mock.calls[0]!;
    expect(msg).toEqual({ type: '__activate_edit_mode' });
    expect((msg as Record<string, unknown>).__codesign).toBeUndefined();

    bridge.off();
  });

  it('on() dispatches handlers for matching incoming messages and unsubscribes', () => {
    const { iframe, contentWindow } = makeIframeStub();
    const bridge = new IframeBridge(iframe);

    const ready = vi.fn();
    const unsubscribe = bridge.on('OVERLAY_READY', ready);

    // Simulate an incoming message from the iframe's contentWindow.
    const event = new MessageEvent('message', {
      data: { __codesign: true, type: 'OVERLAY_READY' },
      source: contentWindow as unknown as Window,
    });
    window.dispatchEvent(event);

    expect(ready).toHaveBeenCalledTimes(1);

    // Unsubscribe and verify no further dispatch.
    unsubscribe();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { __codesign: true, type: 'OVERLAY_READY' },
        source: contentWindow as unknown as Window,
      }),
    );
    expect(ready).toHaveBeenCalledTimes(1);

    bridge.off();
  });

  it('ignores messages from windows other than the iframe', () => {
    const { iframe } = makeIframeStub();
    const bridge = new IframeBridge(iframe);

    const ready = vi.fn();
    bridge.on('OVERLAY_READY', ready);

    // event.source is `null` (default) — should be ignored.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'OVERLAY_READY' },
      }),
    );

    expect(ready).not.toHaveBeenCalled();
    bridge.off();
  });
});
