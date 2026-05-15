// run_script — execute an async JavaScript snippet in a CSP-sandboxed iframe.
//
// Sandbox model:
//   - iframe `sandbox="allow-scripts"` (no allow-same-origin → no DOM access
//     to the parent, no cookies, no localStorage; origin reports as "null")
//   - srcdoc-inlined runtime; no static file required
//   - postMessage RPC for `readFile` / `saveFile` / `ls` (proxied via the
//     same worker routes the agent already uses); request IDs are
//     `crypto.randomUUID()` so an attacker can't guess + spoof rpc:result
//   - Inbound messages are filtered via `isTrustedSandboxEvent`: source must
//     equal the iframe's contentWindow AND origin must be "null"
//     (sandboxed-srcdoc reports "null"); other origins are silently dropped
//   - Wall-clock timeout: default DEFAULT_TIMEOUT_MS, caller may override via
//     `timeoutMs` (clamped to [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS]); on expiry
//     the iframe is removed and an error string is returned
//   - AbortSignal-aware
//
// Returns a structured string with logs + filesWritten + error so the LLM
// can reason about the run.

import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

/** Default wall-clock timeout (ms) when caller doesn't pass `timeoutMs`. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Lower bound for the timeout. Anything shorter is hostile to even trivial scripts. */
export const MIN_TIMEOUT_MS = 1_000;
/** Upper bound for the timeout. Keeps the worst-case stuck script bounded. */
export const MAX_TIMEOUT_MS = 120_000;

/** sandbox attribute on the created iframe. Listed as a constant so tests
 *  can guard against accidental drift (e.g., someone adding allow-same-origin
 *  to debug something and forgetting to revert). */
export const SANDBOX_ATTRIBUTE = 'allow-scripts';

/**
 * Clamp a caller-supplied timeout into [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS].
 * Non-finite / NaN / undefined fall back to DEFAULT_TIMEOUT_MS so a missing
 * input never leaks an unbounded timeout.
 */
export function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS;
  if (ms < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (ms > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return ms;
}

/**
 * Return true iff a postMessage event came from our sandbox iframe and
 * carries the expected origin marker for a srcdoc-sandboxed page.
 *
 * Sandboxed srcdoc without `allow-same-origin` is a unique opaque origin;
 * browsers report it as the string "null". Some older Chromium builds also
 * emitted "about:srcdoc" — accept both. Anything else (e.g., a parent-side
 * extension trying to spoof rpc:result) is silently dropped.
 */
export function isTrustedSandboxEvent(
  ev: MessageEvent,
  iframe: HTMLIFrameElement,
): boolean {
  if (ev.source !== iframe.contentWindow) return false;
  // `origin` may be empty in some test harnesses; treat that as untrusted.
  if (!ev.origin) return false;
  if (ev.origin !== 'null' && ev.origin !== 'about:srcdoc') return false;
  return true;
}

interface ScriptResult {
  logs: string[];
  filesWritten: string[];
  error?: string;
}

interface ScriptDeps {
  /** Override the sandbox runtime for tests. */
  runInSandbox?: (
    projectId: string,
    code: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<ScriptResult>;
}

export const SANDBOX_SRCDOC = `<!doctype html>
<html><head><meta charset="utf-8"><title>script-sandbox</title></head>
<body><script>
(() => {
  const logs = [];
  const filesWritten = [];
  const pendingRpc = new Map();

  function postLog(msg) { logs.push(String(msg)); }

  function rpc(op) {
    return new Promise((resolve, reject) => {
      // crypto.randomUUID() so the parent-side RPC handler can't be tricked
      // by guessing the next id and posting a forged rpc:result.
      const id = crypto.randomUUID();
      pendingRpc.set(id, { resolve, reject });
      window.parent.postMessage({ type: 'rpc', id, op }, '*');
    });
  }

  const captures = {};
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'rpc:result') {
      const p = pendingRpc.get(d.id);
      if (p) {
        pendingRpc.delete(d.id);
        if (d.error) p.reject(new Error(d.error));
        else p.resolve(d.result);
      }
      return;
    }
    if (d.type === 'run') {
      Object.assign(captures, d.captures || {});
      const console = {
        log: (...a) => postLog(a.map(String).join(' ')),
        warn: (...a) => postLog('[warn] ' + a.map(String).join(' ')),
        error: (...a) => postLog('[error] ' + a.map(String).join(' ')),
      };
      const readFile = (path) => rpc({ op: 'readFile', path });
      const saveFile = (path, data) => {
        filesWritten.push(path);
        return rpc({ op: 'saveFile', path, data });
      };
      const ls = (path) => rpc({ op: 'ls', path: path || '' });
      const getCaptures = (key) => captures[key];
      const userCode = d.code;
      (async () => {
        try {
          const fn = new Function(
            'console', 'readFile', 'saveFile', 'ls', 'getCaptures',
            'return (async () => { ' + userCode + ' })()'
          );
          await fn(console, readFile, saveFile, ls, getCaptures);
          window.parent.postMessage({ type: 'done', result: { logs, filesWritten } }, '*');
        } catch (e) {
          window.parent.postMessage({
            type: 'done',
            result: { logs, filesWritten, error: e && e.message ? e.message : String(e) }
          }, '*');
        }
      })();
    }
  });

  window.parent.postMessage({ type: 'ready' }, '*');
})();
</script></body></html>`;

async function defaultRunInSandbox(
  projectId: string,
  code: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ScriptResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { logs: [], filesWritten: [], error: 'run_script requires a browser environment' };
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', SANDBOX_ATTRIBUTE);
  iframe.style.display = 'none';
  iframe.srcdoc = SANDBOX_SRCDOC;
  document.body.appendChild(iframe);

  let settled = false;
  return new Promise<ScriptResult>((resolve) => {
    const cleanup = () => {
      settled = true;
      window.removeEventListener('message', onMessage);
      if (signal) signal.removeEventListener('abort', onAbort);
      iframe.remove();
    };
    const finish = (result: ScriptResult) => {
      if (settled) return;
      cleanup();
      resolve(result);
    };

    const onAbort = () => finish({ logs: [], filesWritten: [], error: 'Aborted' });
    if (signal) {
      if (signal.aborted) {
        document.body.removeChild(iframe);
        return resolve({ logs: [], filesWritten: [], error: 'Aborted' });
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const onMessage = async (ev: MessageEvent) => {
      // Silently drop anything that doesn't come from our sandbox iframe with
      // the expected opaque origin ("null"). An attacker-controlled page open
      // in the same browser session would otherwise be able to post forged
      // rpc:result messages and influence file writes.
      if (!isTrustedSandboxEvent(ev, iframe)) return;
      const data = ev.data as
        | { type: 'ready' }
        | { type: 'done'; result: ScriptResult }
        | { type: 'rpc'; id: string; op: Record<string, unknown> };
      if (!data || typeof data !== 'object') return;

      if (data.type === 'ready') {
        iframe.contentWindow?.postMessage({ type: 'run', code, captures: {} }, '*');
        return;
      }
      if (data.type === 'done') {
        finish(data.result);
        return;
      }
      if (data.type === 'rpc') {
        const op = data.op as { op?: string; path?: string; data?: string };
        try {
          if (op.op === 'readFile' && typeof op.path === 'string') {
            const url = buildUrl(
              `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(op.path)}`,
            );
            const res = await fetch(url);
            if (!res.ok) throw new Error(`readFile ${op.path}: HTTP ${res.status}`);
            iframe.contentWindow?.postMessage(
              { type: 'rpc:result', id: data.id, result: await res.text() },
              '*',
            );
            return;
          }
          if (op.op === 'saveFile' && typeof op.path === 'string') {
            const url = buildUrl(
              `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(op.path)}`,
            );
            const res = await fetch(url, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ content: String(op.data ?? '') }),
            });
            if (!res.ok) throw new Error(`saveFile ${op.path}: HTTP ${res.status}`);
            iframe.contentWindow?.postMessage(
              { type: 'rpc:result', id: data.id, result: null },
              '*',
            );
            return;
          }
          if (op.op === 'ls') {
            const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files`);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`ls: HTTP ${res.status}`);
            const body = (await res.json()) as { files: { path: string }[] };
            const prefix = typeof op.path === 'string' && op.path ? op.path.replace(/\/+$/, '') + '/' : '';
            const filtered = prefix
              ? body.files.filter((f) => f.path.startsWith(prefix))
              : body.files;
            iframe.contentWindow?.postMessage(
              { type: 'rpc:result', id: data.id, result: filtered.map((f) => f.path) },
              '*',
            );
            return;
          }
          throw new Error(`unknown RPC op: ${op.op}`);
        } catch (err) {
          iframe.contentWindow?.postMessage(
            {
              type: 'rpc:result',
              id: data.id,
              error: err instanceof Error ? err.message : String(err),
            },
            '*',
          );
        }
      }
    };
    window.addEventListener('message', onMessage);

    setTimeout(
      () => finish({ logs: [], filesWritten: [], error: `Script timed out after ${timeoutMs / 1000}s` }),
      timeoutMs,
    );
  });
}

export function runScriptTool(projectId: string, deps?: ScriptDeps) {
  const runInSandbox = deps?.runInSandbox ?? defaultRunInSandbox;
  return tool({
    description:
      'Execute an async JavaScript snippet in a CSP-sandboxed iframe with project-file RPC. Available helpers in your code: `console.log/warn/error`, `await readFile(path)`, `await saveFile(path, content)`, `await ls(path?)`, `getCaptures(key)`. Default 30-second timeout (override via `timeoutMs`, clamped to [1s, 120s]). Use for batch file transformations or quick analysis scripts.',
    inputSchema: z
      .object({
        code: z.string().min(1).describe('Async JS code to run (body of an async function).'),
        timeoutMs: z
          .number()
          .optional()
          .describe(
            'Wall-clock timeout in milliseconds. Clamped to [1000, 120000]. Defaults to 30000 if omitted.',
          ),
      })
      .strict(),
    execute: async ({ code, timeoutMs }, { abortSignal }) => {
      const result = await runInSandbox(projectId, code, clampTimeout(timeoutMs), abortSignal);
      const parts: string[] = [];
      if (result.error) parts.push(`Error: ${result.error}`);
      if (result.logs.length > 0) parts.push(`Logs:\n${result.logs.join('\n')}`);
      if (result.filesWritten.length > 0) {
        parts.push(`Files written:\n${result.filesWritten.map((p) => `- ${p}`).join('\n')}`);
      }
      if (parts.length === 0) return '(script ran with no output)';
      return parts.join('\n\n');
    },
  });
}
