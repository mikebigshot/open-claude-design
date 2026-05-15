// inline-error-handler.ts — runs inside the preview iframe.
//
// Renders an in-iframe placeholder when the inline `<script type="text/babel">`
// fails to compile (Babel SyntaxError) or the agent script throws synchronously
// before React mounts anything into `#root`. Without this, a malformed artifact
// (e.g. nested ASCII quotes in a string literal) leaves the iframe completely
// blank — the parent host receives an `IFRAME_ERROR` postMessage but the user
// just sees the cream background and has no idea why nothing rendered.
//
// Design choices:
//   - String-based IIFE, same pattern as `overlay.ts` — avoids cross-compiler
//     drift from `function.toString()`.
//   - Listens for both `error` and `unhandledrejection`. Only paints when
//     `#root` is empty at error time — runtime errors that happen AFTER React
//     mounts (button handlers etc.) are left to the host UI to surface.
//   - Does NOT post `IFRAME_ERROR` itself; overlay.ts already does that, so we
//     keep the postMessage source of truth single.
//   - Source text for the line excerpt is captured via a separate
//     `<script>window.__codesign_iframe_error_source__ = ...</script>` block
//     emitted by `buildSrcdoc`. We try to derive line/col from the error
//     message (Babel formats as `(line:col)`) or use the `lineno` / `colno`
//     fields on the ErrorEvent when present.
//   - Marker attribute is `data-codesign-iframe-error` — host code / tests
//     query against this to verify the placeholder rendered.

/** DOM attribute marking the placeholder root. */
export const INLINE_ERROR_PLACEHOLDER_ATTR = 'data-codesign-iframe-error' as const;

/** Global storing the concatenated agent source text (for line excerpts). */
export const INLINE_ERROR_SOURCE_GLOBAL = '__codesign_iframe_error_source__' as const;

/** Global exposing the render function — useful for tests + future host RPCs. */
export const INLINE_ERROR_RENDER_GLOBAL = '__codesign_render_iframe_error__' as const;

/**
 * Returns the IIFE source string injected near the top of the iframe srcdoc.
 *
 * Execution order matters: this script MUST run before `<script type="text/babel">`
 * does (otherwise the handler isn't registered when Babel throws). buildSrcdoc
 * emits it in `<head>` right after the React-globals capture and before the
 * Babel CDN tag — synchronous parsing guarantees the listeners are in place
 * before DOMContentLoaded fires (which is when Babel processes inline scripts).
 *
 * Exposes `window.__codesign_render_iframe_error__(info)` for tests + future
 * manual triggering.
 */
export function buildInlineErrorHandlerScript(): string {
  return INLINE_ERROR_HANDLER_IIFE_SOURCE;
}

// ---------------------------------------------------------------------------
// IIFE source. Plain ES5 to match the rest of the iframe runtime — no
// optional chaining, no template literals, no `const` (the prelude runs
// before any of our `globalThis` shims).
// ---------------------------------------------------------------------------

const INLINE_ERROR_HANDLER_IIFE_SOURCE = `(function () {
  'use strict';
  var ATTR = 'data-codesign-iframe-error';
  var rendered = false;

  function getSource() {
    try {
      var s = window.__codesign_iframe_error_source__;
      return typeof s === 'string' ? s : '';
    } catch (_) { return ''; }
  }

  // Babel SyntaxError messages format the position as "(line:col)" inside the
  // message body. Some runtimes additionally fill lineno/colno on the
  // ErrorEvent — we prefer those when present, fall back to message parsing.
  function extractLineColFromMessage(message) {
    if (!message) return null;
    var m = /\\((\\d+):(\\d+)\\)/.exec(String(message));
    if (m) {
      var ln = parseInt(m[1], 10);
      var co = parseInt(m[2], 10);
      if (isFinite(ln) && isFinite(co)) return { line: ln, col: co };
    }
    var m2 = /line\\s+(\\d+)/i.exec(String(message));
    if (m2) {
      var ln2 = parseInt(m2[1], 10);
      if (isFinite(ln2)) return { line: ln2, col: 0 };
    }
    return null;
  }

  function getSourceLine(lineno) {
    var src = getSource();
    if (!src || !lineno || lineno < 1) return null;
    var lines = src.split('\\n');
    var idx = lineno - 1;
    if (idx < 0 || idx >= lines.length) return null;
    return lines[idx];
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildCaret(col) {
    if (!col || col < 1) return '';
    var pad = '';
    for (var i = 0; i < col - 1; i++) pad += ' ';
    return pad + '^';
  }

  function renderPlaceholder(info) {
    if (rendered) return true; // already painted; treat as handled
    try {
      var root = document.getElementById('root');
      // Runtime errors after a successful mount: leave the rendered UI alone
      // and let the host surface the error via the IFRAME_ERROR postMessage.
      // The placeholder is specifically for the "iframe rendered nothing" case.
      if (root && root.firstChild) return false;
    } catch (_) {}
    rendered = true;

    var name = info && info.name ? String(info.name) : 'Error';
    var message = info && info.message ? String(info.message) : 'Unknown error';
    // Coordinate priority: message-embedded \`(line:col)\` first, then the
    // ErrorEvent's lineno/colno. Babel Standalone writes the agent-source
    // coordinate into the message body (\`(20:41)\`) but reports a different
    // lineno on the global ErrorEvent (the iframe-doc line, not the agent
    // source). The message-embedded value is the one users need to locate
    // the bug in their source.
    var lineCol = extractLineColFromMessage(message);
    var lineno = lineCol
      ? lineCol.line
      : (info && typeof info.lineno === 'number' && info.lineno > 0 ? info.lineno : 0);
    var colno = lineCol
      ? lineCol.col
      : (info && typeof info.colno === 'number' && info.colno > 0 ? info.colno : 0);
    var sourceLine = lineno ? getSourceLine(lineno) : null;
    var caret = colno ? buildCaret(colno) : '';

    var posLabel = '';
    if (lineno) {
      posLabel = 'Line ' + lineno + (colno ? ':' + colno : '');
    }

    var excerptBlock = '';
    if (sourceLine != null) {
      excerptBlock =
        '<div data-codesign-error-excerpt style="background:#f0ebe0;border:1px solid #d8ceba;' +
          'border-radius:4px;padding:12px;font-size:12px;line-height:1.5;' +
          'overflow-x:auto;margin-top:12px;font-family:\\'JetBrains Mono\\',ui-monospace,SFMono-Regular,Menlo,monospace;">' +
          (posLabel
            ? '<div style="color:#8a7355;margin-bottom:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">' +
                escapeHtml(posLabel) +
              '</div>'
            : '') +
          '<pre data-codesign-error-line style="margin:0;white-space:pre;font-family:inherit;color:#3d2c14;">' +
            escapeHtml(sourceLine) +
          '</pre>' +
          (caret
            ? '<pre data-codesign-error-caret style="margin:0;color:#c96442;font-family:inherit;font-weight:600;">' +
                escapeHtml(caret) +
              '</pre>'
            : '') +
        '</div>';
    }

    var html =
      '<div ' + ATTR + ' role="alert" aria-live="assertive"' +
        ' style="position:fixed;inset:0;display:flex;align-items:flex-start;' +
        'justify-content:center;padding:32px;background:#faf7f2;' +
        'font-family:\\'JetBrains Mono\\',ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'color:#3d2c14;overflow:auto;z-index:2147483647;-webkit-font-smoothing:antialiased;">' +
        '<div style="max-width:720px;width:100%;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
            '<span aria-hidden="true" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c96442;"></span>' +
            '<span style="font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:#8a7355;">Preview failed to render</span>' +
          '</div>' +
          '<div data-codesign-error-name style="font-weight:600;font-size:13px;margin-bottom:4px;color:#3d2c14;">' +
            escapeHtml(name) +
          '</div>' +
          '<div data-codesign-error-message style="font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:#3d2c14;">' +
            escapeHtml(message) +
          '</div>' +
          excerptBlock +
          '<div style="margin-top:16px;font-size:11px;color:#8a7355;line-height:1.5;">' +
            'The iframe bundle could not be compiled or threw before React mounted. ' +
            'Fix the source above and the preview will re-render automatically.' +
          '</div>' +
        '</div>' +
      '</div>';

    function paint() {
      try {
        var body = document.body;
        if (!body) return;
        // Wipe whatever the iframe rendered (typically the empty #root from the
        // <body> baseline) and inject the placeholder as a sibling overlay.
        // We append rather than replace to avoid clobbering other inline
        // scripts attached to body (Tweaks listener, overlay, etc).
        var container = document.createElement('div');
        container.innerHTML = html;
        var node = container.firstChild;
        if (node) body.appendChild(node);
      } catch (_) {}
    }

    if (document.body) {
      paint();
    } else {
      try {
        document.addEventListener('DOMContentLoaded', paint, { once: true });
      } catch (_) {
        // Older IE: fall back to a microtask retry; we already guard with rendered=true.
        try { setTimeout(paint, 0); } catch (__) {}
      }
    }
    return true;
  }

  function handleError(ev) {
    try {
      // Ignore resource load failures (image/script/link 404): the target
      // is an Element other than window, and the message is empty.
      if (ev && ev.target && ev.target !== window && ev.target.nodeType === 1) return;
      var err = ev && ev.error;
      var message = (ev && ev.message)
        ? String(ev.message)
        : (err && err.message ? String(err.message) : '');
      if (!message) return;
      var name = (err && err.name) ? String(err.name) : 'Error';
      var painted = renderPlaceholder({
        name: name,
        message: message,
        lineno: ev && typeof ev.lineno === 'number' ? ev.lineno : 0,
        colno: ev && typeof ev.colno === 'number' ? ev.colno : 0,
        filename: ev && ev.filename ? String(ev.filename) : '',
      });
      // We handled it: paint a placeholder + (via overlay) post IFRAME_ERROR
      // to the host. Suppress the default error reporting so the error
      // doesn't show up as an unhandled page error to test runners watching
      // the host page (Playwright pageerror, Chrome devtools "Errors"
      // counter, etc.). This is a behavior change vs. doing nothing — but
      // it's the correct semantic now that we have an in-iframe error UI.
      if (painted && ev && typeof ev.preventDefault === 'function') {
        try { ev.preventDefault(); } catch (_) {}
      }
    } catch (_) {}
  }

  function handleRejection(ev) {
    try {
      var reason = ev && ev.reason;
      var message = (reason && reason.message) ? String(reason.message) : String(reason);
      if (!message) return;
      var name = (reason && reason.name) ? String(reason.name) : 'UnhandledRejection';
      var painted = renderPlaceholder({ name: name, message: message });
      if (painted && ev && typeof ev.preventDefault === 'function') {
        try { ev.preventDefault(); } catch (_) {}
      }
    } catch (_) {}
  }

  try { window.addEventListener('error', handleError, true); } catch (_) {}
  try { window.addEventListener('unhandledrejection', handleRejection, true); } catch (_) {}

  // Expose for tests + manual triggering (e.g. host-side fallback).
  try { window.__codesign_render_iframe_error__ = renderPlaceholder; } catch (_) {}
})();`;
