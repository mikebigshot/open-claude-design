// PreviewPanel — orchestrates the iframe, the four tool overlays, and the
// parent ↔ iframe message bridge.
//
// State sources:
//   - useWorkspace() for tool, edit, pins, drawingPin, drawStrokes,
//     drawing, drawSubMode, activeTab, projectId
//   - local state for fetched file content (path → string), the artifact's
//     own Tweaks UI availability, and the currently inspected element
//     (Edit mode selection)
//
// Tweaks is artifact-driven only: when the artifact emits __edit_mode_available
// we activate its in-iframe UI and persist its `__edit_mode_set_keys` postMessages
// back to the source file via persistEditModeKeys() (merge into the EDITMODE
// JSON block). When the artifact does NOT expose Tweaks, we render a hint
// instead of a host-side fallback panel — see system-prompt "## Tweaks".
//
// File content fetching is intentionally simple for slice 3 onward: the
// chat/preview agent owns the upstream `tool_block_complete` reaction. When
// a file changes, this panel re-fetches the list + content and rebuilds the
// srcdoc, which the iframe-runtime's cached-root reconciler keeps flicker
// free for the artifact's React tree.
//
// Ownership boundary: this file does NOT mutate workspace state for things
// the chat agent owns (e.g. adding a chat message). Comment "Send to Atelier"
// and Draw "Send" simply emit a workspace action that the chat feature reads
// and turns into a real chat request.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { toPng } from 'html-to-image';
import { showToast } from '@/components/Toast';
import { useT } from '@/i18n';
import { useWorkspace } from '@/state/workspace';
import { ZOOM_MAX, ZOOM_MIN } from '@/state/types';
import type { CommentPin, DrawShape } from '@/state/types';
import { api } from '@/lib/api';
import { useProjectFiles } from '@/state/use-project-files';
import { claudeComplete } from '@/lib/claude-complete';
import { IframeBridge } from '@/lib/iframe-bridge';
import {
  EDITMODE_BEGIN_MARKER,
  EDITMODE_END_MARKER,
} from '@open-design/iframe-runtime/editmode-protocol';
import {
  buildSrcdoc,
  isInlineableTextFile,
  type BundleFile,
} from '@open-design/iframe-runtime/build-srcdoc';
import {
  buildHtmlSrcdoc,
  isHtmlOnlyBundle,
  pickHtmlEntry,
} from '@open-design/iframe-runtime/build-html-srcdoc';
import type { FileRecord, ListFilesResponse } from '@open-design/contracts';

import { PreviewIframe } from './PreviewIframe';
import { EditFloat, type EditSelectionSummary } from './EditFloat';
import { DrawDock } from './DrawDock';
import { DrawOverlay } from './DrawOverlay';
import { CommentPinOverlay } from './CommentPinOverlay';
import { mergePendingEdit, persistEditStyles, type PendingEditEntry } from './persist-edit-styles';
import {
  mergePendingClassEdit,
  persistEditClassNames,
  type PendingClassEditEntry,
} from './persist-edit-classnames';
import {
  cssPropertyToTailwind,
  expandPrefixRemovals,
  extractClassNameFromOuterHTML,
} from './css-to-tailwind';

const Frame = styled.div`
  position: absolute;
  inset: 0;
  background: ${(p) => p.theme.colors.bg100};
  overflow: hidden;
`;

// ZoomScroll — wraps the iframe so zoom transforms can produce scrollable
// overflow when the artifact's viewport exceeds the panel. At zoom='fit' the
// iframe stretches to 100% and there's no overflow.
const ZoomScroll = styled.div`
  position: absolute;
  inset: 0;
  overflow: auto;
`;

const ZoomScale = styled.div`
  /* Width/height + transform set inline so the math is co-located with the
     zoom value. transform-origin: top left keeps scrolling intuitive (origin
     at the corner means scrollLeft/scrollTop map 1:1 to artifact pixels). */
  transform-origin: top left;
  width: 100%;
  height: 100%;
  position: relative;
`;

const Centered = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ${(p) => p.theme.fonts.sans};
  color: ${(p) => p.theme.colors.fg400};
  font-size: 12px;
  text-align: center;
  padding: 24px;
`;

const FloatSlot = styled.div`
  position: absolute;
  top: 60px;
  right: 20px;
  z-index: 50;
`;

const ModeHint = styled.div`
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  background: ${(p) => p.theme.colors.fg100};
  color: #fff;
  font-size: 11.5px;
  border-radius: 999px;
  z-index: 40;
  font-family: ${(p) => p.theme.fonts.sans};
`;

const PinLayer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

// Removed ClickCatcher: previously captured all mouse events in comment mode
// (pointer-events: auto), which blocked the iframe overlay's mouseover from
// firing → no hover outline in Comment mode (regression vs Edit mode, which
// works because Edit doesn't use ClickCatcher). Now Comment mode is fully
// driven by overlay.ts's `onMouseOver` (orange outline) + `onClick` (sends
// ELEMENT_SELECTED with mode='comment'). PreviewPanel's bridge.on
// ELEMENT_SELECTED handler creates the draft pin centered on the element's
// rect — see handleIframeReady. No more host-side click catching.

interface FetchedFile {
  path: string;
  mimeType: string;
  content: string;
}

export function PreviewPanel() {
  const t = useT();
  const { state, dispatch, actions } = useWorkspace();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<IframeBridge | null>(null);

  // Files snapshot — pulled from the workspace-wide shared cache keyed by
  // `(projectId, filesChangedAt)`. Same hook is intended for FileTree /
  // FilePreviewPane to consume so they don't each re-fetch.
  const { files, loadError } = useProjectFiles(state.projectId, state.filesChangedAt ?? 0);
  const [tweaksAvailable, setTweaksAvailable] = useState(false);
  const [editSelection, setEditSelection] = useState<EditSelectionSummary | null>(null);
  // Free-form note for the Draw dock — local because it's purely transient
  // input that resets after Send / Discard. Lifting to workspace state would
  // be over-engineering (no other component reads it).
  const [drawNote, setDrawNote] = useState('');

  // Pending Edit-mode style accumulator. Each EDIT_STYLE postMessage merges
  // into this map keyed by selector; on leaving Edit mode we PUT back to
  // source files and clear. Lives in a ref (not state) — no UI re-renders
  // depend on its contents, only the unmount/leave-mode effect drains it.
  const pendingEditsRef = useRef<Map<string, PendingEditEntry>>(new Map());
  // P2-8 — parallel ref for className-mode edits (AST write-back). When the
  // CSS property + value maps to a high-confidence Tailwind class, we route
  // here instead of pendingEditsRef so the source ends up with `className=
  // "bg-blue-500"` rather than `style={{...}}`. Falls back to pendingEditsRef
  // when no mapping is found (cssPropertyToTailwind returns null).
  const pendingClassEditsRef = useRef<Map<string, PendingClassEditEntry>>(new Map());

  // Ref-based access to current state for the bridge callback so it can stay
  // referentially stable across renders (otherwise PreviewIframe would
  // recreate the bridge on every state tick).
  const stateRef = useRef(state);
  const filesRef = useRef(files);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // (files load handled by useProjectFiles above — module-level cache deduplicates
  //  across PreviewPanel re-mounts and future FileTree / FilePreviewPane consumers.)

  // ───────── build srcdoc whenever files change ─────────
  // 空项目时 srcdoc='' → 渲染 placeholder（不再 fixture fallback；让用户看到自己的产物）
  const srcdoc = useMemo(() => {
    if (files.length === 0) return '';

    // 同样把"全 binary 没文本"的项目也归入 placeholder 路径：
    // 用户刚 paste 几张图但还没让 agent 写 jsx/html 时，files 非空但**没有
    // 任何可内联的文本/HTML**。继续走 buildSrcdoc 会生成只含 React globals 和
    // auto-entry `<App/>` 的空 babel script → iframe console 红字
    // `Uncaught ReferenceError: App is not defined`。直接 fall through 到
    // empty placeholder，让用户看到"先去 chat"的提示而不是错误。
    //
    // 用 buildSrcdoc 内部同款 isInlineableTextFile 判断（mime + 扩展名兜底）
    // 保持判断逻辑单点单源。.html 入口走另一条路径（buildHtmlSrcdoc），
    // isInlineableTextFile('text/html') === true，不会被错误地过滤掉。
    const hasInlineableText = files.some((f) => isInlineableTextFile(f));
    if (!hasInlineableText) return '';

    // HTML-first 入口选择：
    //
    //   1. 用户**主动**选了某个 .html 文件 (state.previewingFile / state.activeTab)
    //      → 用那个 .html 直接渲染（buildHtmlSrcdoc）。即使项目同时含 jsx
    //      也走 HTML 路径，因为用户明确指定了入口。
    //   2. 项目里只有 .html（agent 走原版 single-HTML 范式时的产物）
    //      → 自动 pick 一个 .html
    //   3. 否则 → buildSrcdoc(jsx multi-file React)
    //
    // zip-export 产物属于 case 1：项目里有 'X Prototype.html' wrapper +
    // 多个 jsx；之前 PreviewPanel 直接走 case 3（jsx bundle），忽略 wrapper
    // HTML 导致 import 后看不到正确渲染。
    // baseHref —— 让 <script src="./app.jsx"> 等相对路径 fetch 到真文件
    // 而不是 SPA fallback HTML。同 origin 用绝对 URL（worker 在 8787，但
    // dev server 5173 已 proxy /api 到 worker，所以用当前 origin OK）。
    const baseHref = `${window.location.origin}/api/projects/${encodeURIComponent(state.projectId)}/files/`;

    const explicitHtml = (() => {
      const candidate =
        (typeof state.activeTab === 'string' && /\.html?$/i.test(state.activeTab)
          ? state.activeTab
          : null) ?? state.previewingFile;
      if (!candidate || !/\.html?$/i.test(candidate)) return null;
      return files.find((f) => f.path === candidate) ?? null;
    })();
    if (explicitHtml) return buildHtmlSrcdoc(explicitHtml.content, { baseHref });

    if (isHtmlOnlyBundle(files)) {
      const htmlEntry = pickHtmlEntry(files);
      if (htmlEntry) return buildHtmlSrcdoc(htmlEntry.content, { baseHref });
    }

    const bundle: BundleFile[] = files.map((f) => ({
      path: f.path,
      content: f.content,
      mimeType: f.mimeType,
    }));
    // P2-4 — when VITE_VENDOR_RUNTIME=true, point the iframe runtime at our
    // same-origin /vendor path instead of unpkg.com. The vendored bundles
    // are downloaded by `npm run vendor` and shipped via apps/web/public/.
    // Same-origin works because the iframe inherits the parent origin via
    // `allow-same-origin`. When the env var is unset (dev default), the
    // iframe falls back to the unpkg CDN — matches reference implementation.
    const vendorRuntime = import.meta.env.VITE_VENDOR_RUNTIME === 'true';
    const cdnOptions = vendorRuntime
      ? {
          reactCdn: `${window.location.origin}/vendor`,
          babelCdn: `${window.location.origin}/vendor`,
        }
      : undefined;
    try {
      return buildSrcdoc(bundle, cdnOptions);
    } catch (err) {
      console.warn('[preview] buildSrcdoc threw, falling back to minimal shell:', err);
      return minimalShell(files);
    }
  }, [files, state.activeTab, state.previewingFile, state.projectId]);

  // (entry auto-pick effect lived here previously but was dead code:
  //  PreviewPanel only mounts when activeTab !== DESIGN_FILES_TAB, so the
  //  guard `if (activeTab !== DESIGN_FILES_TAB) return` always fired before
  //  pickEntry got a chance. Moved to FileTree.tsx which IS mounted on the
  //  Design Files tab.)

  // ───────── wire up bridge after iframe mounts ─────────
  const handleIframeReady = useCallback(
    (iframe: HTMLIFrameElement) => {
      iframeRef.current = iframe;
      if (bridgeRef.current) {
        bridgeRef.current.off();
      }
      const bridge = new IframeBridge(iframe);
      bridgeRef.current = bridge;

      bridge.on('OVERLAY_READY', () => {
        // Echo current mode to a freshly mounted overlay (no-op when default).
        const mode = toolToOverlayMode(stateRef.current.tool);
        bridge.send({ type: 'SET_MODE', mode });
      });

      bridge.on('__edit_mode_available', () => {
        setTweaksAvailable(true);
        // If the user is already in Tweaks mode, activate the artifact's UI.
        if (stateRef.current.tool === 'tweaks') {
          bridge.send({ type: '__activate_edit_mode' });
        }
      });

      bridge.on('__edit_mode_set_keys', (msg) => {
        // Persist back to source. The artifact's React state inside the iframe
        // is the source of truth for what the user sees right now — when the
        // PUT fails we don't try to "revert" the iframe (we'd have to round-
        // trip yet another postMessage, and the artifact's state has already
        // moved on). Instead we surface a toast: "your change is unsaved".
        // Reload will revert because the file on disk still has the old keys.
        //
        // P1-8 fix: this used to silently swallow the error; the optimistic
        // UI would then drift from server state with zero user feedback.
        void persistEditModeKeys(stateRef.current.projectId, filesRef.current, msg.edits).catch(
          (err: unknown) => {
            console.error('[preview] failed to persist Tweaks change', err);
            showToast({
              // Keep id stable so rapid drags collapse into one toast (no flicker).
              id: 'tweaks-persist-error',
              message:
                "Couldn't save tweak. Your change is visible in the preview but not saved — reload to discard.",
              variant: 'error',
            });
          },
        );
      });

      bridge.on('ELEMENT_SELECTED', (msg) => {
        if (msg.mode === 'edit') {
          setEditSelection({
            tag: msg.tag,
            selector: msg.selector,
            outerHTML: msg.outerHTML,
            styles: msg.styles,
          });
        } else if (msg.mode === 'comment') {
          // Map iframe-local rect into our overlay's coordinate space. The
          // overlay layer sits on top of the iframe at inset:0, so we can
          // reuse the rect directly (relative to iframe contents).
          const current = stateRef.current;
          const activeFile =
            current.activeTab && current.activeTab !== 'Design Files' ? current.activeTab : null;
          const next: CommentPin = {
            id: crypto.randomUUID(),
            x: msg.rect.x + msg.rect.w / 2,
            y: msg.rect.y + msg.rect.h / 2,
            n: current.pins.length + current.drawStrokes.length + 1,
            text: '',
            selector: msg.selector ?? null,
            filePath: activeFile,
            createdAt: new Date().toISOString(),
          };
          dispatch({ type: 'set_drawing_pin', pin: next });
        }
      });

      bridge.on('IFRAME_ERROR', (msg) => {
        console.warn('[preview] iframe error:', msg.message);
      });

      // window.claude.complete() RPC: artifact JS calls
      // `await window.claude.complete(prompt)`; the iframe overlay forwards
      // it here, we hit OpenRouter's Haiku endpoint with the user's BYOK
      // key and stream chunks back into the iframe. Per the [observation]
      // archive: claude-haiku-4-5 / 1024 max tokens / 30s per-chunk timeout
      // (the 30s is enforced overlay-side; we just forward chunks).
      bridge.on('CLAUDE_COMPLETE', (msg) => {
        const { id, prompt } = msg;
        void (async () => {
          try {
            const text = await claudeComplete(prompt, {
              onChunk: (chunk) => {
                bridge.send({ type: 'CLAUDE_COMPLETE_CHUNK', id, chunk });
              },
            });
            bridge.send({ type: 'CLAUDE_COMPLETE_DONE', id, text });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            bridge.send({ type: 'CLAUDE_COMPLETE_ERROR', id, message });
          }
        })();
      });

      return bridge;
    },
    [dispatch],
  );

  useEffect(() => {
    return () => {
      bridgeRef.current?.off();
      bridgeRef.current = null;
    };
  }, []);

  // ───────── 工具切换 effect 拆分（修闪屏 type-2，2026-05-04）─────────
  // 之前一个 effect 同时干两件事：(A) 切 tool 时发 SET_MODE / Tweaks activate；
  // (B) 离开 Edit 时 flush pending style/className edits 到源文件 + dispatch
  // files_changed。问题：(A) 在每次 tool 切换都跑（含从 null/Comment/Draw 切到
  // Tweaks），dependency 还含 tweaksAvailable —— 任何 toggle 都触发 effect 重跑，
  // 进入 (B) 块（state.tool !== 'edit' 一直为 true 在切到 Tweaks 时也满足），
  // 即便 pending maps 是空，effect 重跑本身的副作用 + Tweaks bridge 重发也会让
  // 用户感到一次轻微闪屏。
  //
  // 拆成两个 effect：
  //   A: SET_MODE + Tweaks activate / deactivate（无 dispatch，无 flush）
  //   B: 仅在 tool 真的从 'edit' → 非 'edit' 时 flush pending edits（由 prevTool
  //      ref 跟踪），其他 tool 切换不进入 flush 逻辑

  // Effect A: tool change → bridge SET_MODE + Tweaks activate/deactivate
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    bridge.send({ type: 'SET_MODE', mode: toolToOverlayMode(state.tool) });
    if (state.tool === 'tweaks' && tweaksAvailable) {
      bridge.send({ type: '__activate_edit_mode' });
    } else if (tweaksAvailable && state.tool !== 'tweaks') {
      bridge.send({ type: '__deactivate_edit_mode' });
    }
  }, [state.tool, tweaksAvailable]);

  // Effect B: 仅当 tool 真的离开 'edit' 时 flush。prevToolRef 跟踪上一帧 tool。
  const prevToolRef = useRef<typeof state.tool>(state.tool);
  useEffect(() => {
    const prev = prevToolRef.current;
    prevToolRef.current = state.tool;

    if (state.tool === 'edit') return; // 没离开 edit
    if (prev !== 'edit') return; // 不是从 edit 离开（普通 tool 切换）—— 关键守卫

    setEditSelection(null);
    const projectId = stateRef.current.projectId;
    const fileSnapshot = filesRef.current.map((f) => ({ path: f.path, content: f.content }));

    const pendingStyles = pendingEditsRef.current;
    if (pendingStyles.size > 0) {
      pendingEditsRef.current = new Map();
      void persistEditStyles(projectId, fileSnapshot, pendingStyles).then(({ written, missed }) => {
        if (missed > 0) {
          console.warn(
            `[edit] ${missed} style edit(s) couldn't be saved (snippet not found in source)`,
          );
          showToast({
            id: 'edit-persist-missed',
            variant: 'error',
            message:
              missed === 1
                ? "Couldn't save 1 style edit — the source isn't a literal JSX tag we can rewrite. Change is visible in the preview but not saved."
                : `Couldn't save ${missed} style edits — the source isn't literal JSX we can rewrite. Changes are visible in the preview but not saved.`,
          });
        }
        if (written > 0) dispatch({ type: 'files_changed' });
      });
    }

    const pendingClasses = pendingClassEditsRef.current;
    if (pendingClasses.size > 0) {
      pendingClassEditsRef.current = new Map();
      void persistEditClassNames(projectId, fileSnapshot, pendingClasses).then(
        ({ written, missed, unsupported }) => {
          if (missed > 0) {
            console.warn(
              `[edit] ${missed} className edit(s) couldn't be saved (snippet not found / parse error)`,
            );
          }
          if (unsupported > 0) {
            console.warn(
              `[edit] ${unsupported} className edit(s) skipped (target uses a non-string className expression like cn(...) — change is staged in the iframe but won't persist)`,
            );
          }
          const total = missed + unsupported;
          if (total > 0) {
            showToast({
              id: 'edit-persist-missed',
              variant: 'error',
              message:
                total === 1
                  ? "Couldn't save 1 className edit — target uses a dynamic className we can't safely rewrite. Change is visible in the preview but not saved."
                  : `Couldn't save ${total} className edits — targets use dynamic classNames we can't safely rewrite. Changes are visible in the preview but not saved.`,
            });
          }
          if (written > 0) dispatch({ type: 'files_changed' });
        },
      );
    }
  }, [state.tool, dispatch]);

  // ───────── trackpad pinch zoom ─────────
  // Mac trackpad pinch fires `wheel` events with `ctrlKey: true` (browser
  // synthesizes this; physical Ctrl key not required). We intercept those,
  // multiply current zoom by an exponential factor for smooth scaling, and
  // clamp to [ZOOM_MIN, ZOOM_MAX]. Non-pinch wheel events (regular scroll)
  // bubble normally so ZoomScroll can scroll the artifact.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const current = stateRef.current.zoom;
      // 'fit' treated as 1.0 starting point so the first pinch gesture has a
      // sensible base instead of jumping to whatever scale 'fit' produced.
      const base = typeof current === 'number' ? current : 1;
      // Exponential factor: deltaY < 0 → pinch out → zoom in.
      const next = base * Math.exp(-event.deltaY * 0.01);
      const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
      dispatch({ type: 'set_zoom', zoom: clamped });
    };
    // passive: false so preventDefault works (Chrome treats wheel as passive
    // by default for performance; we explicitly opt-in to non-passive).
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [dispatch]);

  // ───────── scroll a pin into view when CommentsTab selects it ─────────
  // CommentsTab dispatches set_selected_pin with the pin id. The pin DOM
  // node is rendered in CommentPinOverlay with data-pin-id; we scroll it
  // into view + briefly flash. Cleared after 1500ms so a re-click on the
  // same pin still triggers the effect.
  useEffect(() => {
    const id = state.selectedPinId;
    if (!id) return;
    const node = document.querySelector<HTMLElement>(`[data-pin-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = node.style.outline;
    node.style.outline = '2px solid #C96442';
    node.style.outlineOffset = '4px';
    const timer = window.setTimeout(() => {
      node.style.outline = prev;
      node.style.outlineOffset = '';
      dispatch({ type: 'set_selected_pin', id: null });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [state.selectedPinId, dispatch]);

  // (handleCommentClick removed: pin creation now goes through the iframe
  // overlay's ELEMENT_SELECTED message handler in handleIframeReady. This
  // unblocks the overlay's hover outline in comment mode, which was being
  // suppressed by the prior ClickCatcher.)

  // ───────── comment send handlers ─────────
  const savePin = useCallback(() => {
    if (!state.drawingPin) return;
    actions.addPin(state.drawingPin);
    dispatch({ type: 'set_drawing_pin', pin: null });
  }, [actions, dispatch, state.drawingPin]);

  const sendCommentToAtelier = useCallback(() => {
    if (!state.drawingPin) return;
    const pin = state.drawingPin;
    actions.addPin(pin); // persist to /comments
    dispatch({ type: 'set_drawing_pin', pin: null });
    if (pin.text.trim()) {
      // Stage for ChatPanel to drain via chat.sendMessage. Selector is included
      // so the agent can target the same element if needed.
      const text = pin.selector
        ? `📍 [Pin ${pin.n}] ${pin.text}\n\nElement: \`${pin.selector}\``
        : `📍 [Pin ${pin.n}] ${pin.text}`;
      actions.queueChatSubmit({ text });
    }
  }, [actions, dispatch, state.drawingPin]);

  // ───────── draw send ─────────
  // Take a screenshot of the current preview, queue it as a user message
  // attachment, ChatPanel drains and sends to the agent (vision-capable
  // model). The screenshot rides along in the message FileUIPart so it's
  // persisted with the thread and re-sent on regenerate.
  const sendDraw = useCallback(async () => {
    if (state.drawStrokes.length === 0) return;
    const count = state.drawStrokes.length;
    let dataUrl: string | null = null;
    try {
      const target = iframeRef.current?.contentDocument?.body;
      if (target) dataUrl = await toPng(target as HTMLElement);
    } catch (err) {
      // Cross-origin frames or unsupported CSS → screenshot fails silently;
      // text-only message still flows through to the agent.
      console.warn('[draw] screenshot failed', err);
    }
    // Note-driven message text (img_6 design 2026-05-03):
    //   - non-empty note → use the user's note + "(N annotation(s) attached)"
    //     so the agent sees the request *plus* the count of marks present in
    //     the screenshot.
    //   - empty note → fall back to the auto-synthesized request that we
    //     used before the textarea was added.
    const trimmedNote = drawNote.trim();
    const annotationsTag = `(${count} annotation${count > 1 ? 's' : ''} attached)`;
    const text = trimmedNote
      ? `${trimmedNote} ${annotationsTag}`
      : `🎨 Annotated screenshot with ${count} mark${count > 1 ? 's' : ''}. Please update the design accordingly.`;
    actions.queueChatSubmit({
      text,
      attachments: dataUrl
        ? [{ mediaType: 'image/png', url: dataUrl, filename: `sketch-${Date.now()}.png` }]
        : undefined,
    });
    dispatch({ type: 'set_draw_strokes', strokes: [] });
    setDrawNote('');
    actions.setTool(null);
  }, [actions, dispatch, drawNote, state.drawStrokes.length]);

  // ───────── edit style sync ─────────
  // 1. Push the change to the iframe so the user sees it immediately.
  // 2. Try cssPropertyToTailwind first — if it returns a high-confidence
  //    Tailwind mapping, route to pendingClassEditsRef (AST write-back to
  //    `className=`). Otherwise fall back to pendingEditsRef (inline-style
  //    write-back to `style={{...}}` or `style="..."`). The two paths are
  //    mutually exclusive per (property, value) so the source never carries
  //    both an inline style AND a tailwind class for the same property.
  const handleStyleChange = useCallback(
    (property: string, value: string) => {
      bridgeRef.current?.send({ type: 'EDIT_STYLE', property, value });
      if (!editSelection) return;

      const tailwind = cssPropertyToTailwind(property, value);
      if (tailwind) {
        // Compute concrete remove list from the live element's className at
        // selection time. (PreviewPanel does not track live mutations, so the
        // remove list is "best effort": if the user has already changed the
        // class via a previous handleStyleChange call, the next one may add
        // a class without removing the previous Tailwind add — but the AST's
        // mutateClassList will dedupe.)
        const currentClassList = extractClassNameFromOuterHTML(editSelection.outerHTML);
        const concreteRemovals = expandPrefixRemovals(currentClassList, tailwind.removePrefixes);
        pendingClassEditsRef.current = mergePendingClassEdit(
          pendingClassEditsRef.current,
          editSelection.selector,
          editSelection.outerHTML,
          { add: tailwind.add, remove: concreteRemovals },
        );
      } else {
        pendingEditsRef.current = mergePendingEdit(
          pendingEditsRef.current,
          editSelection.selector,
          editSelection.outerHTML,
          property,
          value,
        );
      }
    },
    [editSelection],
  );

  // ───────── render ─────────
  // (Removed 2026-05-03 P0-2 fix: legacy slice-1 early return that rendered a
  // "file tree lives here" placeholder when activeTab === DESIGN_FILES_TAB.
  // Workspace.tsx now overlays FileTree on top of a permanently-mounted
  // PreviewPanel so the iframe DOM + contentWindow survive tab switches —
  // any early return here would unmount the iframe and break that promise.
  // PreviewPanel always renders the iframe shell now; visibility is owned by
  // the parent's PersistentLayer.)

  // (cursor styling for comment/draw moved into iframe overlay + DrawOverlay
  // respectively after ClickCatcher was removed.)

  // P2-13 — when iframe has no content (empty project / agent hasn't generated
  // yet), suppress all tool floats and show a single "generate preview first"
  // hint. Without this guard, EditFloat / DrawDock float on top of the empty
  // placeholder which is visually broken (no element to inspect, no canvas
  // backdrop to draw on). hasIframeContent is derived from srcdoc — same
  // signal we use to decide whether to mount PreviewIframe at all.
  const hasIframeContent = srcdoc !== '';

  // Tweaks: artifact-driven only. When the artifact emits __edit_mode_available
  // (sets tweaksAvailable=true) we activate its in-iframe UI via __activate_edit_mode.
  // When the artifact does NOT expose Tweaks, show a hint instead — there's no
  // host-side fallback panel because there's no source mapping for it to write to.
  // The empty-iframe case takes precedence: tweaks-without-artifact and
  // tweaks-without-iframe are both "ask Atelier first", but the empty case
  // gets a more specific message.
  const showEmptyToolHint = !hasIframeContent && state.tool !== null;
  const showTweaksHint = !showEmptyToolHint && state.tool === 'tweaks' && !tweaksAvailable;
  const showEditFloat = hasIframeContent && state.tool === 'edit';
  const showDrawDock = hasIframeContent && state.tool === 'draw';

  // Zoom: numeric values apply transform: scale(zoom) and the artifact's
  // logical viewport becomes container/zoom px. 'fit' lets the iframe stretch
  // to 100% (no transform) — the responsive artifact handles its own layout.
  const zoom = state.zoom;
  const zoomStyle: React.CSSProperties =
    zoom === 'fit'
      ? {}
      : {
          transform: `scale(${zoom})`,
          width: `${100 / zoom}%`,
          height: `${100 / zoom}%`,
        };

  return (
    <Frame ref={containerRef}>
      {loadError ? (
        <Centered>{t('preview.errorLoadFiles', { error: loadError })}</Centered>
      ) : srcdoc === '' ? (
        <Centered>
          {t('preview.emptyTitle')}
          <br />
          {t('preview.emptySub')}
        </Centered>
      ) : (
        <ZoomScroll>
          <ZoomScale style={zoomStyle}>
            {/*
              key on filesChangedAt: when the agent writes new files OR the
              user clicks Toolbar's Reload, dispatch({type:'files_changed'})
              ticks the timestamp. Re-keying the iframe forces React to unmount
              the previous instance and mount a fresh one — the browser parses
              srcdoc from scratch, cached-root state inside the artifact is
              wiped, and the user sees the new bundle. Without this, srcdoc
              attribute changes cause the browser to navigate the iframe
              (refresh) but cached-root persists `window.__codesign_tweaks__`
              so the React tree may diff against stale state.
            */}
            <PreviewIframe
              key={state.filesChangedAt}
              ref={iframeRef}
              srcdoc={srcdoc}
              onMessageReady={handleIframeReady}
            />
          </ZoomScale>
        </ZoomScroll>
      )}

      {/* Draw mode uses its own overlay (SVG) for stroke capture. Comment
          mode is fully iframe-driven now (overlay.ts → ELEMENT_SELECTED), so
          there's no host-side click catcher above the iframe — that's what
          lets the comment-mode hover outline actually appear. */}

      <DrawOverlay
        active={state.tool === 'draw'}
        subMode={state.drawSubMode}
        strokes={state.drawStrokes}
        drawing={state.drawing}
        onBegin={(stroke) => dispatch({ type: 'begin_draw', stroke })}
        onMove={(point) => dispatch({ type: 'extend_drawing', point })}
        onEnd={() => dispatch({ type: 'end_drawing' })}
        onClickAnnotation={(click) => dispatch({ type: 'add_click_annotation', click })}
      />

      {/* 用户需求 (b)：非 Comment 模式不显示所有 pin。
          - tool === 'comment': 渲染全部 pin + drawingPin（编辑/新建场景）
          - 其他: 仅渲染 state.selectedPinId 对应的 pin（用户从 Comments 列表点击高亮）。
          drawingPin 只在 comment 模式存在，非 comment 模式始终为 null。*/}
      <PinLayer style={{ pointerEvents: state.drawingPin ? 'auto' : 'none' }}>
        <CommentPinOverlay
          pins={
            state.tool === 'comment'
              ? state.pins
              : state.pins.filter((p) => p.id === state.selectedPinId)
          }
          drawingPin={state.drawingPin}
          onDraftChange={(pin) => dispatch({ type: 'set_drawing_pin', pin })}
          onDraftCancel={() => dispatch({ type: 'set_drawing_pin', pin: null })}
          onSavePin={savePin}
          onSendToAtelier={sendCommentToAtelier}
        />
      </PinLayer>

      {state.tool === 'comment' && !state.drawingPin ? (
        <ModeHint>{t('preview.commentHint')}</ModeHint>
      ) : null}

      {showEmptyToolHint ? (
        <ModeHint data-testid="preview-empty-tool-hint">{t('preview.toolNeedsPreview')}</ModeHint>
      ) : null}

      {showTweaksHint ? <ModeHint>{t('preview.tweaksUnavailable')}</ModeHint> : null}

      {showEditFloat ? (
        <FloatSlot>
          <EditFloat
            edit={state.edit}
            selection={editSelection}
            onEditChange={(partial) => actions.setEdit(partial)}
            onStyleChange={handleStyleChange}
          />
        </FloatSlot>
      ) : null}

      {showDrawDock ? (
        <DrawDock
          subMode={state.drawSubMode}
          strokeCount={countStrokes(state.drawStrokes)}
          note={drawNote}
          onNoteChange={setDrawNote}
          onSubModeChange={(mode) => dispatch({ type: 'set_draw_sub_mode', mode })}
          onUndo={() => actions.undoStroke()}
          onDiscard={() => {
            actions.setDrawStrokes([]);
            setDrawNote('');
            actions.setTool(null);
          }}
          onSend={() => void sendDraw()}
          /* streaming-aware disabling moved out of workspace state during cleanup;
             ChatPanel owns the streaming flag via useAgentChat. The Send button
             still disables itself when there are 0 strokes. */
          sendDisabled={false}
        />
      ) : null}
    </Frame>
  );
}

function toolToOverlayMode(
  tool: ReturnType<typeof useWorkspace>['state']['tool'],
): 'comment' | 'edit' | 'tweaks' | 'draw' | null {
  return tool;
}

function countStrokes(strokes: DrawShape[]): number {
  return strokes.length;
}

/** Minimal HTML for the case where buildSrcdoc isn't available yet. */
function minimalShell(files: FetchedFile[]): string {
  const indexFile =
    files.find((f) => f.path.toLowerCase() === 'index.html') ??
    files.find((f) => f.path.toLowerCase().endsWith('.html'));
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Preview</title></head>
<body style="font-family: Inter, system-ui; padding: 24px; color: #5A574F">
${indexFile ? indexFile.content : '<p>Preview pipeline pending — slice 3 in flight.</p>'}
</body></html>`;
}

/**
 * Update EDITMODE-BEGIN/END block in the active artifact source on the server.
 *
 * The system prompt promises "only included keys are merged" (see
 * apps/web/src/features/chat/system-prompt.ts "## Tweaks"). To honor that,
 * we parse the existing EDITMODE JSON, shallow-merge `edits` over it, then
 * stringify back. If the existing block isn't valid JSON we fall back to
 * writing `edits` alone — preserves forward progress over a malformed source.
 *
 * keepalive: true on the PUT so the request survives a refresh that lands
 * between the slider drag and the response.
 */
const EDITMODE_BLOCK_RE = /\/\*EDITMODE-BEGIN\*\/([\s\S]*?)\/\*EDITMODE-END\*\//;

async function persistEditModeKeys(
  projectId: string,
  files: FetchedFile[],
  edits: Record<string, unknown>,
): Promise<void> {
  // 找 EDITMODE 块的目标文件 —— 优先 .jsx / .tsx（agent 写的真源），不选
  // .html（zip-export 生成的 wrapper 里也可能含 EDITMODE 块）。
  // wrapper HTML 体积大（动辄数百 KB），写回会触发 keepalive 64KB 限制 → fetch 失败。
  const candidates = files.filter(
    (f) => f.content.includes(EDITMODE_BEGIN_MARKER) && f.content.includes(EDITMODE_END_MARKER),
  );
  if (candidates.length === 0) return;
  const target =
    candidates.find((f) => /\.(jsx|tsx)$/i.test(f.path)) ??
    candidates.find((f) => /\.(js|ts|mjs)$/i.test(f.path)) ??
    candidates[0]!;
  const match = target.content.match(EDITMODE_BLOCK_RE);
  const existing = match ? safeParseJson(match[1]!) : {};
  const merged = { ...existing, ...edits };
  const json = JSON.stringify(merged, null, 2);
  const replaced = target.content.replace(
    EDITMODE_BLOCK_RE,
    `${EDITMODE_BEGIN_MARKER}${json}${EDITMODE_END_MARKER}`,
  );
  if (replaced === target.content) return;
  // **不要** keepalive: true —— 它对 body 有 64KB 上限。Tweaks 改大文件
  // (1MB+ jsx) 时会被浏览器悄悄拒掉报 'Failed to fetch'。原意是让 PUT 在
  // 页面跳转时仍发出（防止 unmount 期间 dispatch 丢失），但 Tweaks 通常不
  // 伴随跳转，重要性低于 body size 兼容性。
  await api(`/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(target.path)}`, {
    method: 'PUT',
    body: { path: target.path, content: replaced } as unknown as BodyInit,
  });
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw.trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
