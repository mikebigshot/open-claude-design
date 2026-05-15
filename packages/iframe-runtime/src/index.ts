// iframe-runtime — 注入 preview iframe 的运行时模块。
//
// 提供完整的 iframe 端逻辑：
//   - postMessage 协议类型（ParentToIframe / IframeToParent）
//   - EDITMODE 块协议（标记常量 + extract / replace 工具）
//   - srcdoc 拼装（多文件 bundle + 文件依赖排序 + close-script 转义）
//   - OVERLAY_SCRIPT 注入（comment / edit / OVERLAY_READY / EDIT_STYLE / navguard）
//   - Tweaks bridge 注入（cached root + Babel 重编译 listener）
//
// **零运行时依赖** —— 整个 package 是 type-only + 字符串拼接。

export const IFRAME_RUNTIME_VERSION = '0.0.0' as const;

// 协议常量 + 类型
export {
  EDITMODE_BEGIN_MARKER,
  EDITMODE_END_MARKER,
  DATA_CODESIGN_ID_ATTR,
  extractEditModeBlock,
  replaceEditModeBlock,
} from './editmode-protocol';
export type { ParentToIframe, IframeToParent, SelectorStrategy } from './editmode-protocol';

// srcdoc 拼装
export {
  buildSrcdoc,
  escapeForScript,
  sortFilesForExecution,
  findEditmodeFile,
  hasEntryCall,
  isInlineableTextFile,
} from './build-srcdoc';
export type { BundleFile, BuildSrcdocOptions } from './build-srcdoc';

// HTML-only 路径（agent 产单 .html 时走这条，绕开 Babel JSX bundle）
export { buildHtmlSrcdoc, pickHtmlEntry, isHtmlOnlyBundle } from './build-html-srcdoc';
export type { BuildHtmlSrcdocOptions } from './build-html-srcdoc';

// Inline error handler — iframe 内编译/运行时错误的 placeholder 渲染
export {
  buildInlineErrorHandlerScript,
  INLINE_ERROR_PLACEHOLDER_ATTR,
  INLINE_ERROR_SOURCE_GLOBAL,
  INLINE_ERROR_RENDER_GLOBAL,
} from './inline-error-handler';

// Overlay 注入
export { buildOverlayScript } from './overlay';

// Tweaks bridge
export {
  buildTweaksBridge,
  buildTweaksBridgeSetup,
  buildTweaksBridgeListener,
} from './tweaks-bridge';

// Cached-root helper（语义和 buildTweaksBridgeSetup 等价，但单独暴露以便复用）
export { patchCreateRootForReconcile } from './cached-root';
