// Right-side file preview pane shown inside the Design Files split layout.
//
// When the user clicks a row in FileTree, dispatch sets state.previewingFile;
// this pane reads it, fetches the file's content + metadata, and renders:
//   - HTML files → mini iframe sandbox preview
//   - JSX/JS/CSS/JSON/text → first ~80 lines of source
//   - Images → centered <img> from the GET endpoint
//   - Anything else → just the metadata card
//
// "Open" button promotes the previewed file to an open tab + activeTab.
// Workspace.tsx then routes to PreviewPanel (HTML) or FileSourceView (others).

import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';

import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { useWorkspace } from '@/state/workspace';
import type { FileRecord } from '@open-design/contracts';
import { buildHtmlSrcdoc } from '@open-design/iframe-runtime/build-html-srcdoc';

// 布局：右侧不撑满，仅顶部居中显示一个固定尺寸卡片预览 + Open 按钮 +
// 文件名 + 元数据，自上而下排列。
const Pane = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: ${({ theme }) => theme.colors.bg100};
  border-left: 1px solid ${({ theme }) => theme.colors.line100};
  padding: 24px 20px;
  gap: 16px;
`;

const PreviewCard = styled.div`
  width: 280px;
  height: 200px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const OpenButton = styled.button`
  padding: 6px 14px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.fg100};
  color: ${({ theme }) => theme.colors.bg100};
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
  &:hover {
    opacity: 0.85;
  }
`;

const InfoBlock = styled.div`
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 320px;
`;

const FileName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.fg100};
  word-break: break-all;
`;

const FileType = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.fg300};
`;

const MetaRow = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.fg400};
  margin-top: 6px;
`;

const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: ${({ theme }) => theme.colors.fg300};
  font-size: 13px;
  text-align: center;
  padding: 24px;
  line-height: 1.5;
`;

const SourcePre = styled.pre`
  margin: 0;
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 12px;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.fg100};
  background: ${({ theme }) => theme.colors.bg200};
  padding: 14px 16px;
  border-radius: 8px;
  white-space: pre;
  /* 不在这里 overflow:auto —— 父容器 Body 已 overflow:auto；嵌套 scroll 体验差。
     宽超出仍水平滚（继承 Body）。*/
`;

// HtmlFrame 缩到卡片大小，内部 transform scale 让 1280x800 stage 看起来像
// 整页（跟 ProjectThumb 同款做法）。pointer-events: none —— 这是预览不接受
// 交互；用户要操作走 Open 按钮进 PreviewPanel。
const HtmlStage = styled.div`
  width: 1280px;
  height: 914px;
  transform: scale(0.21875); /* 280/1280 */
  transform-origin: top left;
`;

const HtmlFrame = styled.iframe`
  width: 1280px;
  height: 914px;
  border: 0;
  pointer-events: none;
  background: white;
`;

const ImagePreview = styled.img`
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
`;

const ErrorText = styled.div`
  padding: 12px 16px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
  border-radius: 6px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.fg300};
`;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'image/svg+xml';
}

interface FilePreviewPaneProps {
  files: FileRecord[];
}

export function FilePreviewPane({ files }: FilePreviewPaneProps) {
  const t = useT();
  const { state, dispatch } = useWorkspace();
  const path = state.previewingFile;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const file = useMemo<FileRecord | null>(() => {
    if (!path) return null;
    return files.find((f) => f.path === path) ?? null;
  }, [files, path]);

  useEffect(() => {
    if (!file) {
      setContent(null);
      return;
    }
    if (!isTextMime(file.mimeType)) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    (async () => {
      try {
        // expectText: true bypasses api()'s auto JSON parse so .json files
        // round-trip byte-for-byte (preserves indentation / key order /
        // trailing newline). Without it, the worker's application/json
        // response would be JSON.parse'd then re-stringified — silently
        // mangling the original formatting the user wrote.
        const text = await api<string>(
          `/api/projects/${encodeURIComponent(file.projectId)}/files/${encodeURI(file.path)}`,
          { expectText: true },
        );
        if (cancelled) return;
        if (typeof text === 'string') setContent(text);
        else if (text === undefined || text === null) setContent('');
        else setContent(JSON.stringify(text, null, 2));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (!file) {
    return (
      <Pane data-testid="file-preview-pane">
        <Empty data-testid="file-preview-empty">
          {t('filePane.empty')}
          <br />
          {t('filePane.openHintPrefix')}
          <strong>{t('filePane.open')}</strong>
          {t('filePane.openHintSuffix')}
        </Empty>
      </Pane>
    );
  }

  const handleOpen = () => {
    dispatch({ type: 'open_file', name: file.path });
  };

  // baseHref 让 .html 内 `<script src="./app.jsx">` 等相对路径 fetch 到真
  // 文件而不是 SPA fallback HTML。
  const htmlBaseHref = `${window.location.origin}/api/projects/${encodeURIComponent(file.projectId)}/files/`;

  const renderCard = () => {
    if (error)
      return <ErrorText data-testid="file-preview-error">{t('filePane.errorLoad', { error })}</ErrorText>;
    if (loading) return <Empty data-testid="file-preview-loading">{t('common.loading')}</Empty>;
    if (file.mimeType === 'text/html' && content !== null) {
      return (
        <HtmlStage>
          <HtmlFrame
            title={file.path}
            sandbox="allow-scripts"
            srcDoc={buildHtmlSrcdoc(content, { baseHref: htmlBaseHref, injectOverlay: false })}
            data-testid="file-preview-html-frame"
          />
        </HtmlStage>
      );
    }
    if (isImageMime(file.mimeType)) {
      return (
        <ImagePreview
          src={`/api/projects/${encodeURIComponent(file.projectId)}/files/${encodeURI(file.path)}`}
          alt={file.path}
          data-testid="file-preview-image"
        />
      );
    }
    if (content !== null) {
      // 文件树预览只显示前 ~10 行截图视感（小卡片放不下全量）；用户要看全
      // 走 Open → FileSourceView。
      const preview = content.split('\n').slice(0, 12).join('\n');
      return (
        <SourcePre data-testid="file-preview-source-pre">{preview}</SourcePre>
      );
    }
    return <Empty>{t('filePane.noPreview')}</Empty>;
  };

  return (
    <Pane data-testid="file-preview-pane" data-file-path={file.path}>
      <PreviewCard>{renderCard()}</PreviewCard>
      <OpenButton type="button" onClick={handleOpen} data-testid="file-preview-open-btn">
        ↗ {t('filePane.open')}
      </OpenButton>
      <InfoBlock>
        <FileName title={file.path} data-testid="file-preview-filename">
          {file.path}
        </FileName>
        <FileType data-testid="file-preview-mime">{prettyType(file.mimeType, t)}</FileType>
        <MetaRow>
          {t('filePane.modifiedMeta', {
            time: formatRelative(file.updatedAt, t),
            size: formatSize(file.size),
          })}
        </MetaRow>
      </InfoBlock>
    </Pane>
  );
}

type TFn = ReturnType<typeof useT>;

function prettyType(mime: string, t: TFn): string {
  if (mime === 'text/html') return t('fileType.htmlPage');
  if (mime === 'text/jsx') return t('fileType.component');
  if (mime === 'text/css') return t('fileType.stylesheet');
  if (mime === 'application/json') return t('fileType.json');
  if (mime === 'image/svg+xml') return t('fileType.svg');
  if (mime.startsWith('image/')) return t('fileType.image');
  if (mime === 'text/javascript') return t('fileType.script');
  return mime;
}

function formatRelative(updatedAt: string, t: TFn): string {
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return updatedAt;
  const diff = Date.now() - ts;
  const m = 60_000;
  if (diff < m) return t('common.justNow');
  if (diff < 60 * m) return t('common.minutesAgo', { n: Math.floor(diff / m) });
  const h = 60 * m;
  if (diff < 24 * h) return t('common.hoursAgo', { n: Math.floor(diff / h) });
  const d = 24 * h;
  if (diff < 7 * d) return t('common.daysAgo', { n: Math.floor(diff / d) });
  return new Date(updatedAt).toLocaleDateString();
}
