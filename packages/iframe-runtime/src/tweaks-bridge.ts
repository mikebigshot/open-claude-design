// tweaks-bridge.ts — Tweaks 重编译桥（无闪烁实时调参）。
//
// 输出两段字符串：
//   1. SETUP（在 React UMD 之后、agent 脚本之前注入）：拦截 createRoot 复用 root
//   2. LISTENER（在 agent 脚本之后注入）：监听父发的 `codesign:tweaks:update`
//      消息，正则替换 EDITMODE 块、Babel transform、用 new Function 重新执行
//
// 协议：
//   - parent 发 `codesign:tweaks:update { tokens: {...} }` 给 iframe（codesign 协议层）
//   - artifact 内部发 `__edit_mode_set_keys { edits: {...} }` 给 parent（tweaks 协议层）
//   - parent 收到 set_keys 后可以**自行**把变化映射成 codesign:tweaks:update 推回 iframe
//     来触发重编译；保留这条路径以便支持父侧驱动场景（artifact 自带 React state 时
//     不需要主动推，重 render 已经搞定）。
//
// EDITMODE 标记 + 各 type 字符串均 clone-fidelity-critical。

import { patchCreateRootForReconcile } from './cached-root';

/**
 * 返回 setup 阶段注入的 IIFE 字符串：拦截 createRoot 复用 root。
 *
 * 内部直接复用 `patchCreateRootForReconcile()` —— Setup 在语义上就是 patch CreateRoot。
 *
 * 必须在 React UMD 之后、agent 脚本之前注入。
 */
export function buildTweaksBridgeSetup(): string {
  return patchCreateRootForReconcile();
}

/**
 * 返回 listener 阶段注入的 IIFE 字符串：监听父发的 tweaks update，重编译 + reconcile。
 *
 * 必须在 agent 脚本之后注入（要先存 originalScript 才能重编译）。
 */
export function buildTweaksBridgeListener(): string {
  return TWEAKS_BRIDGE_LISTENER_SOURCE;
}

/**
 * 一键注入：返回完整的 Tweaks bridge 字符串拼接（setup + listener）。
 *
 * 实际 srcdoc 拼装时不能这样直接拼接 —— setup 必须在 agent 脚本之前、listener 必须在之后。
 * 此 helper 仅用于不需要 agent 脚本对齐的场景（如测试断言里检查关键字）。
 */
export function buildTweaksBridge(): string {
  return buildTweaksBridgeSetup() + '\n' + buildTweaksBridgeListener();
}

const TWEAKS_BRIDGE_LISTENER_SOURCE = `(function () {
  'use strict';
  if (!window.__codesign_tweaks__) return;
  var EDITMODE_RE = /\\/\\*EDITMODE-BEGIN\\*\\/[\\s\\S]*?\\/\\*EDITMODE-END\\*\\//;
  function applyTokens(tokens) {
    var state = window.__codesign_tweaks__;
    if (!state.originalScript || !state.root || !window.Babel) return;
    var json;
    try { json = JSON.stringify(tokens, null, 2); } catch (_) { return; }
    var nextScript = state.originalScript.replace(
      EDITMODE_RE,
      '/*EDITMODE-BEGIN*/' + json + '/*EDITMODE-END*/'
    );
    var compiled;
    try {
      compiled = window.Babel.transform(nextScript, { presets: ['react'] }).code;
    } catch (err) {
      try { console.warn('[tweaks-bridge] babel compile failed:', err && err.message); } catch (_) {}
      return;
    }
    try {
      new Function('React', 'ReactDOM', compiled)(window.React, window.ReactDOM);
    } catch (err) {
      try { console.warn('[tweaks-bridge] re-eval failed:', err && err.message); } catch (_) {}
    }
  }
  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== 'codesign:tweaks:update') return;
    if (!data.tokens || typeof data.tokens !== 'object') return;
    applyTokens(data.tokens);
  });
})();`;
