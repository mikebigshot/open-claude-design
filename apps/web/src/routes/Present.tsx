// Present 全屏播放路由 — `/p/:id/present`。
//
// 仅渲染一个全屏 iframe（无 chat、no toolbar、no overlay）。读 project files
// → buildSrcdoc / buildHtmlSrcdoc → srcdoc。ESC 返回 `/p/:id`。
//
// PRD 写到 Present▾ 下拉含 Full screen / Without chrome / Speaker view（[推测]
// 见 PRD 模糊点清单），MVP 只做 "Without chrome"——把 Workspace 上的 chrome
// 全部隐藏。Speaker view / Full screen API 留 V2。

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';

import type { FileRecord, ListFilesResponse } from '@open-design/contracts';
import { buildSrcdoc, type BundleFile } from '@open-design/iframe-runtime/build-srcdoc';
import {
  buildHtmlSrcdoc,
  isHtmlOnlyBundle,
  pickHtmlEntry,
} from '@open-design/iframe-runtime/build-html-srcdoc';

import { api } from '@/lib/api';
import { PreviewIframe } from '@/features/preview/PreviewIframe';
import { useT } from '@/i18n';

const FullScreen = styled.div`
  position: fixed;
  inset: 0;
  background: ${(p) => p.theme.colors.bg100};
  display: flex;
  flex-direction: column;
  z-index: 1000;
`;

const Hint = styled.div`
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  background: ${(p) => p.theme.colors.fg100};
  color: #fff;
  font-size: 11.5px;
  font-family: ${(p) => p.theme.fonts.mono};
  border-radius: 999px;
  letter-spacing: 0.4px;
  opacity: 0.85;
  pointer-events: none;
`;

const Empty = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ${(p) => p.theme.fonts.sans};
  color: ${(p) => p.theme.colors.fg400};
  font-size: 12px;
`;

export function Present() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const t = useT();
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const list = await api<ListFilesResponse>(`/api/projects/${encodeURIComponent(id)}/files`);
        const fetched = await Promise.all(
          list.files.map(async (r: FileRecord) => ({
            path: r.path,
            mimeType: r.mimeType,
            content: await api<string>(
              `/api/projects/${encodeURIComponent(id)}/files/${encodeURI(r.path)}`,
            ),
          })),
        );
        if (cancelled) return;

        if (fetched.length === 0) {
          setSrcdoc('');
          return;
        }

        if (isHtmlOnlyBundle(fetched)) {
          const entry = pickHtmlEntry(fetched);
          if (entry) {
            // Present 模式不注入 overlay：4 工具不可用，artifact 自由滚动 / 全屏
            setSrcdoc(buildHtmlSrcdoc(entry.content, { injectOverlay: false }));
            return;
          }
        }

        const bundle: BundleFile[] = fetched.map((f) => ({
          path: f.path,
          content: f.content,
          mimeType: f.mimeType,
        }));
        setSrcdoc(buildSrcdoc(bundle, { injectOverlay: false, injectTweaks: false }));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && id) navigate(`/p/${id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, navigate]);

  if (error) {
    return (
      <FullScreen>
        <Empty>{t('present.error', { error })}</Empty>
        <Hint>{t('present.escHint')}</Hint>
      </FullScreen>
    );
  }

  if (srcdoc === null) {
    return (
      <FullScreen>
        <Empty>{t('present.loading')}</Empty>
      </FullScreen>
    );
  }

  if (srcdoc === '') {
    return (
      <FullScreen>
        <Empty>{t('present.empty')}</Empty>
        <Hint>{t('present.escHint')}</Hint>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      <PreviewIframe srcdoc={srcdoc} title="Present" />
      <Hint>{t('present.escHintExit')}</Hint>
    </FullScreen>
  );
}

export default Present;
