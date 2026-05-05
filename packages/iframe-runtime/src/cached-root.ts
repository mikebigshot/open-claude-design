// cached-root.ts — patch ReactDOM.createRoot for in-place reconcile.
//
// 核心 trick：把 `ReactDOM.createRoot(el)` 替换成"第一次正常调用，之后返回缓存"。
// agent 脚本里的 `ReactDOM.createRoot(...).render(<App/>)` 第一次执行时挂载 root，
// 第二次执行（Tweaks 重跑 bundle）复用同一个 root → React reconciler 走 diff 路径
// → 无闪烁更新 DOM。
//
// 必须在 React UMD 之后、agent 脚本之前注入。

/**
 * 返回打 patch 的 IIFE 字符串，注入 iframe srcdoc。
 *
 * 执行后会：
 *   1. 在 `window.__codesign_tweaks__` 上初始化 `{ root: null, originalScript: null }`
 *   2. 拦截 `ReactDOM.createRoot` —— 只第一次真正调用，之后返回缓存的 root
 *
 * 调用方需保证：
 *   - 已经有 `window.ReactDOM.createRoot`（即 React UMD 已加载）
 *   - 在 agent script 之前执行
 *
 * @returns 形如 `"(function(){...})();"` 的 JavaScript 源码字符串。
 */
export function patchCreateRootForReconcile(): string {
  return PATCH_CREATE_ROOT_SOURCE;
}

const PATCH_CREATE_ROOT_SOURCE = `(function () {
  'use strict';
  if (!window.ReactDOM || typeof window.ReactDOM.createRoot !== 'function') return;
  window.__codesign_tweaks__ = { root: null, originalScript: null };
  var origCreateRoot = window.ReactDOM.createRoot;
  window.ReactDOM.createRoot = function (el) {
    if (window.__codesign_tweaks__.root) return window.__codesign_tweaks__.root;
    var root = origCreateRoot.call(this, el);
    window.__codesign_tweaks__.root = root;
    return root;
  };
})();`;
