// 源代码 Tab —— 当 activeTab 是 JSX / JS / CSS / JSON / text 文件时渲染。
//
// 跟 PreviewPanel（iframe 渲染整个 entry）的分工：
//   - HTML  → PreviewPanel（实际跑起来）
//   - 其余  → FileSourceView（只看代码）
//
// MVP 版无 syntax highlighting —— 等实际有需要再引入 Shiki / Prism。
// 行号 + monospace + 粗略的 line wrapping 已经够开发者用了。
//
// a11y: root 暴露 role="region" + aria-label + aria-live="polite",
// 这样切换文件 (path prop 变) 时屏幕阅读器会播报新文件名。loading state
// 用 role="status" (polite,适合异步进度);error 用 role="alert" (assertive,
// 中断) 因为加载失败用户应该立即听到。
//
// Scroll behavior (2026-05-03 fix for "源代码预览窗口没有把所有内容显示出
// 来 / 不能滚动到底"):
//   - 重 fetch 不抹掉当前内容: 当 state.filesChangedAt tick (chat agent 写
//     了文件) 而 path/projectId 没换时,我们后台 refresh 但保持 <table> 在
//     DOM 里。这样滚动位置不丢,用户能继续阅读原本看到的位置。
//   - <table> 后填 32px 缓冲区: 防止 Workspace 那个 fixed-position DropHint
//     ("↓ DROP FILES HERE") 在小屏幕上把最后一行盖住。
//   - scrollbar-gutter: stable: 不论有没有触发滚动条,Body 宽度不抖。

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';

import { api } from '@/lib/api';
import { useWorkspace } from '@/state/workspace';

const Frame = styled.div`
  position: absolute;
  inset: 0;
  background: ${({ theme }) => theme.colors.bg100};
  display: flex;
  flex-direction: column;
  font-family: ${({ theme }) => theme.fonts.sans};
`;

const Header = styled.div`
  padding: 12px 18px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.line100};
  display: flex;
  align-items: center;
  gap: 12px;
`;

const FileLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.fg100};
  font-family: ${({ theme }) => theme.fonts.mono};
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 0 32px 0;
  /* 保持滚动条 gutter 稳定: 文件长度变化不会导致 body 宽度抖动 / 文字回流。
     另外这样在 macOS overlay-scrollbar 隐藏时,用户也有视觉提示 "这里可以滚"。 */
  scrollbar-gutter: stable;
`;

const SourceTable = styled.table`
  border-collapse: collapse;
  width: 100%;
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 12.5px;
  line-height: 1.55;
  color: ${({ theme }) => theme.colors.fg100};
`;

const LineNumberCell = styled.td`
  width: 1%;
  padding: 0 12px 0 16px;
  text-align: right;
  user-select: none;
  color: ${({ theme }) => theme.colors.fg400};
  vertical-align: top;
  border-right: 1px solid ${({ theme }) => theme.colors.line100};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const LineContentCell = styled.td`
  padding: 0 16px;
  white-space: pre;
`;

const Centered = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.fg300};
  padding: 24px;
  text-align: center;
`;

const ErrorBox = styled.div`
  padding: 18px;
  margin: 24px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
  border-radius: 8px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.fg300};
`;

interface FileSourceViewProps {
  path: string;
}

export function FileSourceView({ path }: FileSourceViewProps) {
  const { state } = useWorkspace();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Tracks the (projectId, path) pair the current `content` was fetched for.
  // When path/projectId change → "hard" reload (clear table, show Loading).
  // When only filesChangedAt changes → "soft" refresh (keep current table +
  // scroll position; quietly swap content when fetch resolves). The user's
  // bug report ("不能滚动到底") came from the hard-reload-on-every-tick path:
  // chat agent writing any file in the same project would tick filesChangedAt
  // → useEffect re-ran → setContent(null) unmounted the <table> → scrollTop
  // reset to 0 → user felt "the bottom keeps slipping away".
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!state.projectId || !path) return;
    const key = `${state.projectId}::${path}`;
    const isPathChange = loadedKeyRef.current !== key;
    let cancelled = false;
    setError(null);
    if (isPathChange) {
      // Hard reload — clear content + show loading state.
      setLoading(true);
      setContent(null);
      loadedKeyRef.current = key;
    }
    // Soft reload (filesChangedAt tick on same path): keep current content
    // in DOM + scroll position. Only flip `loading` indicator implicitly
    // through the shared isLoading flag — no Loading… UI takeover.
    (async () => {
      try {
        // expectText: true bypasses api()'s auto JSON parse so .json source
        // files round-trip byte-for-byte (preserves indent / key order /
        // trailing newline). Source view is the canonical place users read
        // raw .json files, so mangling formatting would be very visible.
        const text = await api<string>(
          `/api/projects/${encodeURIComponent(state.projectId)}/files/${encodeURI(path)}`,
          { expectText: true },
        );
        if (cancelled) return;
        // Snapshot scrollTop before content swap so we can restore it for
        // soft refreshes. (Hard reloads land at scrollTop=0 by design.)
        const prevScrollTop = !isPathChange ? (bodyRef.current?.scrollTop ?? 0) : 0;
        if (typeof text === 'string') setContent(text);
        else if (text === undefined || text === null) setContent('');
        else setContent(JSON.stringify(text, null, 2));
        // After React commits the new content, restore scroll. We use an
        // rAF so it runs *after* the table re-renders with the new lines.
        if (!isPathChange && prevScrollTop > 0 && typeof window !== 'undefined') {
          window.requestAnimationFrame(() => {
            if (cancelled) return;
            const body = bodyRef.current;
            if (body) body.scrollTop = prevScrollTop;
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.projectId, path, state.filesChangedAt]);

  // a11y: root is a labeled live region — switching files (path prop change)
  // is announced to AT without interrupting current speech.
  const a11yProps = {
    role: 'region' as const,
    'aria-label': 'File source view',
    'aria-live': 'polite' as const,
  };

  if (loading && content === null) {
    return (
      <Frame {...a11yProps} data-testid="file-source-content" data-file-path={path}>
        <Centered role="status" data-testid="file-source-loading">
          Loading {path}…
        </Centered>
      </Frame>
    );
  }
  if (error) {
    return (
      <Frame {...a11yProps} data-testid="file-source-content" data-file-path={path}>
        <ErrorBox role="alert" data-testid="file-source-error">
          Could not load {path}: {error}
        </ErrorBox>
      </Frame>
    );
  }
  if (content === null) {
    return (
      <Frame {...a11yProps} data-testid="file-source-content" data-file-path={path}>
        <Centered data-testid="file-source-empty">File is empty.</Centered>
      </Frame>
    );
  }

  const lines = content.length === 0 ? [''] : content.split('\n');

  return (
    <Frame {...a11yProps} data-testid="file-source-content" data-file-path={path}>
      <Header>
        <FileLabel data-testid="file-source-filename">{path}</FileLabel>
      </Header>
      <Body ref={bodyRef} data-testid="file-source-body">
        <SourceTable data-testid="file-source-view">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <LineNumberCell>{idx + 1}</LineNumberCell>
                <LineContentCell>{line.length === 0 ? ' ' : line}</LineContentCell>
              </tr>
            ))}
          </tbody>
        </SourceTable>
      </Body>
    </Frame>
  );
}
