import { buildSrcdoc, type BundleFile } from '@open-design/iframe-runtime/build-srcdoc';
import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import { api } from '@/lib/api';

// 多卡片网格用 live-iframe-at-scale 渲染缩略图，无需 screenshot 基础设施。
// 每个卡片 IO 触发 mount，fetch 项目 files，buildSrcdoc 拼成 srcdoc，
// CSS scale 0.22 显示。
//
// - 数据源走 GET /api/projects/:id/files + 每个文件 GET 拿 content（多文件 React 项目）
// - buildSrcdoc 接收 BundleFile[]，自己处理 EDITMODE / 多文件 bundling
// - cache key = projectId:updatedAt（agent 改文件后 projects.updated_at 应 bump）
// - 缓存 srcdoc 字符串（CDN 模式不内联 React/Babel，size 小，可塞 localStorage）

// 冻结动画/transition/audio/video，让卡片像静态截图
const THUMBNAIL_STYLE = `<style>
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
  scrollbar-width: none !important;
}
*::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
html, body { overflow: hidden !important; margin: 0 !important; }
video, audio { display: none !important; }
</style>`;

function injectThumbnailStyle(srcDoc: string): string {
  if (/<\/head>/i.test(srcDoc)) {
    return srcDoc.replace(/<\/head>/i, `${THUMBNAIL_STYLE}</head>`);
  }
  return THUMBNAIL_STYLE + srcDoc;
}

// ── 两层缓存：内存 LRU（同 session 切 tab 复用）+ localStorage（重开浏览器复用）──
const memCache = new Map<string, string>();
const LS_PREFIX = 'projectThumb:';
const LS_MAX_CHARS = 300_000;
const LS_MAX_ENTRIES = 40;
const MEM_MAX_ENTRIES = 40;

function cacheKey(projectId: string, updatedAt: string): string {
  return `${projectId}:${updatedAt}`;
}

function memCacheTouch(key: string, value: string): void {
  memCache.delete(key);
  memCache.set(key, value);
  while (memCache.size > MEM_MAX_ENTRIES) {
    const oldest = memCache.keys().next().value;
    if (oldest === undefined) break;
    memCache.delete(oldest);
  }
}

function readCache(key: string): string | null {
  const hit = memCache.get(key);
  if (hit !== undefined) {
    memCacheTouch(key, hit);
    return hit;
  }
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw !== null) memCacheTouch(key, raw);
    return raw;
  } catch {
    return null;
  }
}

function pruneOldestCacheEntries(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) keys.push(k);
    }
    if (keys.length < LS_MAX_ENTRIES) return;
    keys.sort();
    for (let i = 0; i < keys.length - LS_MAX_ENTRIES + 1; i++) {
      const k = keys[i];
      if (k !== undefined) localStorage.removeItem(k);
    }
  } catch {
    /* noop */
  }
}

function writeCache(key: string, srcdoc: string): void {
  memCacheTouch(key, srcdoc);
  if (typeof localStorage === 'undefined') return;
  if (srcdoc.length > LS_MAX_CHARS) return;
  try {
    pruneOldestCacheEntries();
    localStorage.setItem(LS_PREFIX + key, srcdoc);
  } catch {
    /* quota exceeded — in-memory only */
  }
}

// ── styled containers ──
const Root = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #fff;
`;

const Stage = styled.div`
  width: 1280px;
  height: 960px;
  transform-origin: top left;
`;

const StageIframe = styled.iframe`
  width: 1280px;
  height: 960px;
  border: 0;
  pointer-events: none;
  background: #fff;
`;

const Skeleton = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(
    110deg,
    ${(p) => p.theme.colors.bg200} 0%,
    rgba(0, 0, 0, 0.03) 40%,
    ${(p) => p.theme.colors.bg200} 80%
  );
  animation: pulse 1.4s ease-in-out infinite;
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }
`;

interface FileRecord {
  path: string;
  contentType: string;
  size: number;
  sha256: string;
}

interface FileListResponse {
  files: FileRecord[];
}

export interface ProjectThumbProps {
  projectId: string;
  /** 用作 cache key 的一部分；agent 改文件后 projects.updated_at bump → 自动失效 */
  updatedAt: string;
  /** 渲染失败 / 项目无内容时由父组件兜底渲染（保留原 SVG placeholder） */
  fallback: React.ReactNode;
}

/**
 * 项目卡片缩略图：在 IntersectionObserver 触发后 fetch 项目所有 file 内容、
 * buildSrcdoc 成 srcdoc、scale 显示。
 *
 * fallback：项目还没文件 / 网络失败 → 渲染父传入的 SVG placeholder。
 */
export function ProjectThumb({ projectId, updatedAt, fallback }: ProjectThumbProps) {
  const [srcdoc, setSrcdoc] = useState<string | null>(() =>
    readCache(cacheKey(projectId, updatedAt)),
  );
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [scale, setScale] = useState(0.22);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // IO: 卡片接近视口才 mount iframe，避免一次起 N 个 iframe 卡顿
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '240px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 卡片尺寸变化时自适应 scale —— 让 1280x960 stage 完全 cover 卡片
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w <= 0 || h <= 0) continue;
        const next = Math.max(w / 1280, h / 960);
        setScale((prev) => (Math.abs(prev - next) > 0.001 ? next : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // visible + cache miss → fetch files + buildSrcdoc
  useEffect(() => {
    if (!visible) return;
    const key = cacheKey(projectId, updatedAt);
    const cached = readCache(key);
    if (cached !== null) {
      setSrcdoc(cached);
      setFailed(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await api<FileListResponse>(`/api/projects/${projectId}/files`);
        if (cancelled || !mountedRef.current) return;
        if (!list.files || list.files.length === 0) {
          setFailed(true);
          return;
        }
        const bundle: BundleFile[] = await Promise.all(
          list.files.map(async (record) => {
            const content = await api<string>(
              `/api/projects/${projectId}/files/${encodeURI(record.path)}`,
              { expectText: true },
            );
            return {
              path: record.path,
              mimeType: record.contentType,
              content,
            };
          }),
        );
        if (cancelled || !mountedRef.current) return;
        const built = buildSrcdoc(bundle);
        const final = injectThumbnailStyle(built);
        writeCache(key, final);
        setSrcdoc(final);
      } catch {
        if (!cancelled && mountedRef.current) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, projectId, updatedAt]);

  const stageStyle = useMemo(() => ({ transform: `scale(${scale})` }) as const, [scale]);

  return (
    <Root ref={rootRef} aria-hidden>
      {srcdoc ? (
        <Stage style={stageStyle}>
          <StageIframe title={`Preview ${projectId}`} srcDoc={srcdoc} sandbox="allow-scripts" />
        </Stage>
      ) : failed ? (
        fallback
      ) : (
        <Skeleton />
      )}
    </Root>
  );
}
