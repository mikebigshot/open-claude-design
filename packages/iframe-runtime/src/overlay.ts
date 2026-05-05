// overlay.ts — runs inside the preview iframe.
//
// 一个 ~140 行的 IIFE 字符串，由 buildSrcdoc 注入到 srcdoc 的最末尾 `<script>` 里执行。
//
// 为何用字符串字面量而不是 `function ... .toString()`：toString 在 TS 里依赖编译器把类型注解
// strip 掉，跨编译器（tsc / esbuild / swc）输出格式不同。直接写字符串，源头确定。
//
// 协议字符串字面量（`SET_MODE` / `OVERLAY_READY` / `EDIT_STYLE` / `ELEMENT_SELECTED`
// / `CLEAR_PIN` / `IFRAME_ERROR` / `data-codesign-id`）是 wire-protocol bits，
// 改了会破坏与既有 artifact / overlay 实现的兼容性。

/**
 * 返回注入到 iframe srcdoc 内的 overlay JavaScript 代码字符串。
 *
 * 调用语义：在父侧 buildSrcdoc 拼接时通过 `<script>` + `buildOverlayScript()` + `</script>` 注入。
 *
 * 输出的代码会立即执行（IIFE）：
 *   - 监听父发的 SET_MODE / EDIT_STYLE / CLEAR_PIN
 *   - hover / click 选中上报 ELEMENT_SELECTED（含 mode、selector、tag、outerHTML、rect、styles?）
 *   - DOM ready 后发 OVERLAY_READY
 *   - 三阶选择器降级（data-codesign-id → id → 手算 XPath）
 *   - 200ms `setInterval` 重挂监听器（防 AI 生成代码 removeEventListener / freeze prototypes）
 *   - navguard：`window.open` / `location.assign` / `location.replace` no-op + `<a>` 链接拦截
 *   - error / unhandledrejection 上报 IFRAME_ERROR
 *
 * @returns 形如 `"(function(){...})();"` 的字符串。
 */
export function buildOverlayScript(): string {
  return OVERLAY_IIFE_SOURCE;
}

// ---------------------------------------------------------------------------
// IIFE 源码 —— 在 iframe 内部执行的 ES5 JavaScript。
// 字符串字面量里的 `__codesign` envelope + 各 `type` 字符串均 clone-fidelity-critical。
// ---------------------------------------------------------------------------

const OVERLAY_IIFE_SOURCE = `(function () {
  'use strict';
  var hovered = null;
  var pinned = null;
  var currentMode = 'default';

  var HOVER_OUTLINE = '2px solid #c96442';
  var PINNED_OUTLINE = '2.5px solid #b5441a';

  function clearHover() {
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = ''; } catch (_) {}
    }
    hovered = null;
  }
  function clearPinned() {
    if (pinned) {
      try { pinned.style.outline = ''; } catch (_) {}
    }
    pinned = null;
  }

  function getSelector(el) {
    if (el.dataset && el.dataset.codesignId)
      return '[data-codesign-id="' + el.dataset.codesignId + '"]';
    if (el.id) return '#' + el.id;
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body) {
      var idx = 1;
      var sib = el.previousElementSibling;
      while (sib) {
        if (sib.tagName === el.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(el.tagName.toLowerCase() + '[' + idx + ']');
      el = el.parentElement;
    }
    return '/' + parts.join('/');
  }

  // Properties surfaced in Edit mode (returned with ELEMENT_SELECTED).
  var EDIT_PROPS = [
    'width', 'height',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'border-width', 'border-style', 'border-color', 'border-radius',
    'background-color', 'color', 'font-size', 'font-family', 'opacity'
  ];
  function readStyles(el) {
    var cs = window.getComputedStyle(el);
    var out = {};
    for (var i = 0; i < EDIT_PROPS.length; i++) {
      var p = EDIT_PROPS[i];
      out[p] = cs.getPropertyValue(p);
    }
    return out;
  }

  function onMouseOver(e) {
    if (currentMode !== 'comment' && currentMode !== 'edit') return;
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = ''; } catch (_) {}
    }
    hovered = e.target;
    if (hovered && hovered !== pinned) {
      try { hovered.style.outline = HOVER_OUTLINE; } catch (_) {}
    }
  }
  function onMouseOut() {
    if (currentMode === 'comment' || currentMode === 'edit') clearHover();
  }

  function onClick(e) {
    if (currentMode === 'comment' || currentMode === 'edit') {
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      if (pinned && pinned !== el) {
        try { pinned.style.outline = ''; } catch (_) {}
      }
      pinned = el;
      try { el.style.outline = PINNED_OUTLINE; } catch (_) {}
      var rect = el.getBoundingClientRect();
      var msg = {
        __codesign: true,
        type: 'ELEMENT_SELECTED',
        mode: currentMode,
        selector: getSelector(el),
        tag: el.tagName.toLowerCase(),
        outerHTML: (el.outerHTML || '').slice(0, 600),
        rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
      };
      if (currentMode === 'edit') {
        try { msg.styles = readStyles(el); } catch (_) {}
      }
      try {
        window.parent.postMessage(msg, '*');
      } catch (err) {
        try { console.warn('[overlay] postMessage ELEMENT_SELECTED failed:', err); } catch (_) {}
      }
      return;
    }
    // default mode: block link navigation.
    var anchor = e.target;
    while (anchor && anchor.tagName !== 'A') anchor = anchor.parentElement;
    if (anchor && (anchor.href || anchor.getAttribute('href'))) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function applyStyle(property, value) {
    if (!pinned) return;
    try {
      if (property === 'border-width') {
        pinned.style.setProperty('border-width', value);
        if (!pinned.style.borderStyle) pinned.style.borderStyle = 'solid';
      } else {
        pinned.style.setProperty(property, value);
      }
    } catch (_) {}
  }

  function onParentMessage(ev) {
    if (!ev || ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || data.__codesign !== true) return;
    if (data.type === 'SET_MODE') {
      currentMode = (data.mode === 'comment' || data.mode === 'edit') ? data.mode : 'default';
      if (currentMode === 'default') { clearHover(); clearPinned(); }
      // Surface the mode visually inside the iframe via cursor styling — gives
      // users a clear "I'm in comment/edit mode now" affordance once the host's
      // ClickCatcher (which used to set cursor: crosshair) was removed in
      // favor of overlay-driven hover.
      try {
        document.body.style.cursor =
          (currentMode === 'comment' || currentMode === 'edit') ? 'crosshair' : '';
      } catch (_) {}
      return;
    }
    if (data.type === 'CLEAR_PIN') { clearPinned(); return; }
    if (data.type === 'EDIT_STYLE') {
      applyStyle(data.property, data.value);
      return;
    }
    // window.claude.complete() streaming: route chunk/done/error to the
    // pending request keyed by id.
    if (data.type === 'CLAUDE_COMPLETE_CHUNK' && data.id && claudePending[data.id]) {
      var pendingChunk = claudePending[data.id];
      pendingChunk.text += String(data.chunk || '');
      pendingChunk.onChunk();
      return;
    }
    if (data.type === 'CLAUDE_COMPLETE_DONE' && data.id && claudePending[data.id]) {
      var pendingDone = claudePending[data.id];
      delete claudePending[data.id];
      pendingDone.resolve(typeof data.text === 'string' ? data.text : pendingDone.text);
      return;
    }
    if (data.type === 'CLAUDE_COMPLETE_ERROR' && data.id && claudePending[data.id]) {
      var pendingErr = claudePending[data.id];
      delete claudePending[data.id];
      pendingErr.reject(new Error(String(data.message || 'claude.complete failed')));
      return;
    }
  }

  // window.claude.complete(prompt: string): Promise<string>
  // Streams a Haiku 4.5 (host-enforced) response. 30s timeout per chunk;
  // every chunk resets the timer. clone-fidelity per [§09:189-213].
  var claudePending = {};
  var claudeRequestCounter = 0;
  function claudeComplete(prompt) {
    return new Promise(function (resolve, reject) {
      if (typeof prompt !== 'string' || !prompt) {
        reject(new Error('claude.complete: prompt must be a non-empty string'));
        return;
      }
      var id = 'cc-' + (++claudeRequestCounter) + '-' + Date.now();
      var timeoutMs = 30000;
      var pending = {
        text: '',
        timer: null,
        resolve: function (v) {
          if (pending.timer) { try { clearTimeout(pending.timer); } catch (_) {} }
          resolve(v);
        },
        reject: function (e) {
          if (pending.timer) { try { clearTimeout(pending.timer); } catch (_) {} }
          delete claudePending[id];
          reject(e);
        },
        onChunk: function () {
          if (pending.timer) { try { clearTimeout(pending.timer); } catch (_) {} }
          pending.timer = setTimeout(function () {
            if (claudePending[id] === pending) {
              pending.reject(new Error('claude.complete: timeout (no chunks for 30s)'));
            }
          }, timeoutMs);
        },
      };
      claudePending[id] = pending;
      pending.onChunk();  // start the timer
      try {
        window.parent.postMessage({
          __codesign: true,
          type: 'CLAUDE_COMPLETE',
          id: id,
          prompt: prompt,
        }, '*');
      } catch (err) {
        pending.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
  if (!window.claude) {
    try {
      Object.defineProperty(window, 'claude', {
        value: { complete: claudeComplete },
        writable: false,
        configurable: false,
      });
    } catch (_) {
      window.claude = { complete: claudeComplete };
    }
  }

  function onError(ev) {
    try {
      window.parent.postMessage({
        __codesign: true,
        type: 'IFRAME_ERROR',
        kind: 'error',
        message: ev && ev.message ? String(ev.message) : 'unknown',
        source: ev && ev.filename ? String(ev.filename) : undefined,
        lineno: ev && typeof ev.lineno === 'number' ? ev.lineno : undefined
      }, '*');
    } catch (_) {}
  }
  function onRejection(ev) {
    try {
      var reason = ev && ev.reason;
      var msg = (reason && reason.message) ? String(reason.message) : String(reason);
      window.parent.postMessage({
        __codesign: true, type: 'IFRAME_ERROR', kind: 'unhandledrejection', message: msg
      }, '*');
    } catch (_) {}
  }

  var installs = [
    { evt: 'mouseover', fn: onMouseOver },
    { evt: 'mouseout', fn: onMouseOut },
    { evt: 'click', fn: onClick }
  ];
  function reattach() {
    for (var i = 0; i < installs.length; i++) {
      var spec = installs[i];
      try { document.removeEventListener(spec.evt, spec.fn, true); } catch (_) {}
      try { document.addEventListener(spec.evt, spec.fn, true); } catch (_) {}
    }
    if (!window.__cs_err) {
      window.addEventListener('error', onError, true);
      window.__cs_err = true;
    }
    if (!window.__cs_rej) {
      window.addEventListener('unhandledrejection', onRejection, true);
      window.__cs_rej = true;
    }
    if (!window.__cs_msg) {
      window.addEventListener('message', onParentMessage, false);
      window.__cs_msg = true;
    }
  }
  reattach();
  try { clearInterval(window.__cs_reattach_interval); } catch (_) {}
  window.__cs_reattach_interval = setInterval(reattach, 200);

  if (!window.__cs_navguard) {
    window.__cs_navguard = true;
    try { window.open = function () { return null; }; } catch (_) {}
    try {
      var loc = window.location;
      try { loc.assign = function () {}; } catch (_) {}
      try { loc.replace = function () {}; } catch (_) {}
    } catch (_) {}
  }

  try { window.parent.postMessage({ __codesign: true, type: 'OVERLAY_READY' }, '*'); } catch (_) {}
})();`;
