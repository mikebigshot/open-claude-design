// iframe-bridge.ts — request/response RPC over postMessage to the preview iframe.
//
// AGENT_* tools (screenshot / eval_js / get_webview_logs / multi_screenshot)
// post a typed request into the preview iframe and wait for a matching
// response keyed by `requestId`. The bridge handles:
//   - finding the iframe (by `[data-chat-id="<id>"]`, fallback to first iframe)
//   - generating requestId
//   - timeout (default 10s)
//   - abort signal
//   - mismatched requestId is ignored
//
// Iframe-side handlers live in `packages/iframe-runtime/src/overlay.ts`.

export type AgentRequestType = 'AGENT_SCREENSHOT' | 'AGENT_EVAL_JS' | 'AGENT_GET_LOGS';

const RESPONSE_FOR: Record<AgentRequestType, string> = {
  AGENT_SCREENSHOT: 'AGENT_SCREENSHOT_RESULT',
  AGENT_EVAL_JS: 'AGENT_EVAL_JS_RESULT',
  AGENT_GET_LOGS: 'AGENT_GET_LOGS_RESULT',
};

/**
 * Viewport selector for the two-pane architecture (Phase 2):
 *   - 'user'  → user-visible preview iframe (default; what the user looks at)
 *   - 'agent' → hidden agent-private iframe (verifier sub-agent uses this so
 *     it doesn't disturb the user's view)
 *
 * The host shell renders both per chat. RPC posts find the right iframe via
 * the `[data-viewport]` attribute (in addition to `[data-chat-id]`).
 */
export type Viewport = 'user' | 'agent';

export interface RequestFromIframeOpts {
  /** Chat id used to find the matching `<iframe data-chat-id="...">` element. */
  chatId: string;
  /** Which pane to talk to. Default: 'user'. */
  viewport?: Viewport;
  /** Request type — must be one of the known AGENT_* types. */
  type: AgentRequestType;
  /** Extra fields to merge into the posted message body. */
  payload?: Record<string, unknown>;
  /** Timeout in ms (default 10_000). Reject with an Error containing "timeout". */
  timeoutMs?: number;
  /** Abort signal — when fired, reject with an Error containing "abort". */
  signal?: AbortSignal;
}

function findIframe(chatId: string, viewport: Viewport): HTMLIFrameElement | null {
  // Strict match: chat-id + viewport.
  const strict = document.querySelector<HTMLIFrameElement>(
    `iframe[data-chat-id="${CSS.escape(chatId)}"][data-viewport="${viewport}"]`,
  );
  if (strict) return strict;
  // Compat fallback: chat-id only (pre-Phase-2 host shells without
  // `data-viewport` still pair correctly). Prefer the matching chat-id over
  // an arbitrary iframe.
  const chatMatch = document.querySelector<HTMLIFrameElement>(
    `iframe[data-chat-id="${CSS.escape(chatId)}"]`,
  );
  if (chatMatch) return chatMatch;
  // Last resort: any iframe in the page.
  return document.querySelector<HTMLIFrameElement>('iframe');
}

let counter = 0;
function nextRequestId(): string {
  counter += 1;
  return `agent-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function requestFromIframe<T = unknown>(opts: RequestFromIframeOpts): Promise<T> {
  const viewport: Viewport = opts.viewport ?? 'user';
  const iframe = findIframe(opts.chatId, viewport);
  if (!iframe || !iframe.contentWindow) {
    throw new Error(
      `requestFromIframe: no iframe found for chatId="${opts.chatId}" viewport="${viewport}"`,
    );
  }
  const requestId = nextRequestId();
  const expectedResponseType = RESPONSE_FOR[opts.type];
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
      window.removeEventListener('message', onMessage);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }

    function settle(action: () => void) {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    }

    function onMessage(ev: MessageEvent) {
      const data = ev.data as { type?: string; requestId?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.requestId !== requestId) return;
      if (data.type !== expectedResponseType) return;
      settle(() => resolve(data as unknown as T));
    }

    function onAbort() {
      settle(() => reject(new Error('requestFromIframe: aborted')));
    }

    window.addEventListener('message', onMessage);
    if (opts.signal) {
      if (opts.signal.aborted) {
        settle(() => reject(new Error('requestFromIframe: aborted')));
        return;
      }
      opts.signal.addEventListener('abort', onAbort);
    }

    timer = setTimeout(() => {
      settle(() => reject(new Error(`requestFromIframe: timeout after ${timeoutMs}ms`)));
    }, timeoutMs);

    const body = { type: opts.type, requestId, ...(opts.payload ?? {}) };
    try {
      // postMessage origin '*' — preview iframe is sandboxed; we don't know its origin in advance.
      iframe.contentWindow!.postMessage(body, '*');
    } catch (err) {
      settle(() =>
        reject(err instanceof Error ? err : new Error(`requestFromIframe: postMessage failed`)),
      );
    }
  });
}
