// editmode-protocol.ts — postMessage protocol + EDITMODE block helpers + selector strategy.
//
// 协议字符串字面量是 clone-fidelity-critical（见 CLAUDE.md §2）。任何重命名都会破坏与
// 既有 artifact / 第三方 export 的兼容性，禁止改。

// ---------------------------------------------------------------------------
// postMessage protocol (parent ↔ iframe).
// ---------------------------------------------------------------------------

/**
 * Messages sent from the parent host to the preview iframe.
 *
 * `__activate_edit_mode` / `__deactivate_edit_mode` 走 Tweaks 协议
 * —— 不带 `__codesign` envelope。其它消息都属于 codesign overlay 协议。
 */
export type ParentToIframe =
  | { type: 'SET_MODE'; mode: 'comment' | 'edit' | 'tweaks' | 'draw' | null }
  | { type: 'EDIT_STYLE'; property: string; value: string }
  | { type: 'CLEAR_PIN' }
  | { type: '__activate_edit_mode' }
  | { type: '__deactivate_edit_mode' }
  // window.claude.complete() RPC: parent → iframe streaming response.
  | { type: 'CLAUDE_COMPLETE_CHUNK'; id: string; chunk: string }
  | { type: 'CLAUDE_COMPLETE_DONE'; id: string; text: string }
  | { type: 'CLAUDE_COMPLETE_ERROR'; id: string; message: string };

/**
 * Messages sent from the preview iframe back to the parent host.
 *
 * `__edit_mode_available` / `__edit_mode_set_keys` 同样走 Tweaks 协议，
 * 由 artifact 内部代码自己发出（不是 OVERLAY_SCRIPT 发的）。
 */
export type IframeToParent =
  | { type: 'OVERLAY_READY' }
  | {
      type: 'ELEMENT_SELECTED';
      mode: 'comment' | 'edit';
      selector: string;
      tag: string;
      outerHTML: string;
      rect: { x: number; y: number; w: number; h: number };
      styles?: Record<string, string>;
    }
  | { type: 'IFRAME_ERROR'; message: string }
  | { type: '__edit_mode_available' }
  | { type: '__edit_mode_set_keys'; edits: Record<string, unknown> }
  // window.claude.complete() RPC: iframe asks the host to call the LLM.
  // Host MUST stream chunks back via CLAUDE_COMPLETE_CHUNK and finally
  // CLAUDE_COMPLETE_DONE (or CLAUDE_COMPLETE_ERROR on failure).
  | { type: 'CLAUDE_COMPLETE'; id: string; prompt: string };

// ---------------------------------------------------------------------------
// EDITMODE block markers + helpers.
// ---------------------------------------------------------------------------

/** EDITMODE 块起始标记。clone-fidelity，不可改。 */
export const EDITMODE_BEGIN_MARKER = '/*EDITMODE-BEGIN*/' as const;

/** EDITMODE 块结束标记。clone-fidelity，不可改。 */
export const EDITMODE_END_MARKER = '/*EDITMODE-END*/' as const;

/**
 * 用于全局匹配 EDITMODE 块的正则 —— 包含 begin / 内容 / end 三段。
 * 内容部分非贪婪以支持同文件多个块（虽然实际只期望一个）。
 *
 * 注意：每次需要新实例（带 lastIndex 状态），由 helper 内部 new 出来。
 */
function editmodeBlockRegex(): RegExp {
  return /\/\*EDITMODE-BEGIN\*\/([\s\S]*?)\/\*EDITMODE-END\*\//;
}

/**
 * 抽出 source 里的 EDITMODE 块 body（不含两端标记，原始字符串，未做 JSON parse）。
 *
 * 找不到时返回 null。
 */
export function extractEditModeBlock(source: string): string | null {
  const m = editmodeBlockRegex().exec(source);
  if (!m || typeof m[1] !== 'string') return null;
  return m[1];
}

/**
 * 把 source 里的 EDITMODE 块 body 替换成 `newBody`（新 body 应是 JSON.stringify 出来的字符串）。
 *
 * 找不到 EDITMODE 块时直接返回原 source（不抛错）—— 调用方若需要校验请自行先调用 `extractEditModeBlock` 检测。
 *
 * 不会对 newBody 做 escape；newBody 不可包含 `/*EDITMODE-END*\/` 序列。
 */
export function replaceEditModeBlock(source: string, newBody: string): string {
  return source.replace(
    editmodeBlockRegex(),
    EDITMODE_BEGIN_MARKER + newBody + EDITMODE_END_MARKER,
  );
}

// ---------------------------------------------------------------------------
// 三阶选择器策略接口 —— 描述 overlay 内部的选择器降级顺序。
// ---------------------------------------------------------------------------

/**
 * 选择器策略：iframe 内部选中元素时三阶降级。
 *
 * - `data-codesign-id`：优先（agent 主动加的稳定 ID，跨重生成可命中）
 * - `id`：次之（DOM 原生 ID）
 * - `xpath`：最后（手算 XPath，对动态内容不稳定但兜底）
 *
 * 实现细节见 overlay.ts 里 `getSelector(el)`。
 */
export interface SelectorStrategy {
  /** 优先级第一档：`data-codesign-id` 属性。 */
  readonly codesignId: '[data-codesign-id="<value>"]';
  /** 优先级第二档：CSS `#id`。 */
  readonly elementId: '#<id>';
  /** 优先级第三档：手算 XPath（兄弟节点序号路径）。 */
  readonly xpath: '/<tag>[<idx>]/<tag>[<idx>]/...';
}

/**
 * data-codesign-id 属性名（HTML attribute）。
 * agent 在生成 artifact 时加在关键元素上，以确保跨重生成的元素选择稳定。
 */
export const DATA_CODESIGN_ID_ATTR = 'data-codesign-id' as const;
