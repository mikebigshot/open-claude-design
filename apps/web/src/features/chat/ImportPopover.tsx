// Add-context popover (mirrors prototype `proto-chat.jsx` import popover).
//
// Currently only "Upload screenshots" is enabled — the other 4 options render
// disabled with a "Coming soon" tooltip.
//
// Upload flow（跟 Composer paste 路径统一）：
// 1. FileReader → dataURL → onAttachmentAdd 立即在 composer 上方显示 thumbnail
//    （SDK files 多模态 attachment，模型当前 turn 直接 visually 看到图）
// 2. fire-and-forget PUT /api/projects/:id/files/uploads/<filename> 让 file
//    进 D1+R2 进 file tree（持久化，跟原版 claude.ai/design 一致）
// 之前走 chip 路径但 ChatPanel 没传 onChipsChange，chip 永远不显示；现在统一
// 走 attachments，thumbnail UX 跟 paste 一致。

import { useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useT } from '@/i18n';
import { IconFolder, IconGlobe, IconLink, IconPaperclip, IconSparkle } from './icons';
import type { PendingAttachment } from '@/state/types';
import { buildUrl } from '@/lib/api.js';

type DictKey = Parameters<ReturnType<typeof useT>>[0];

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  /**
   * 选好 file 后回调，传 PendingAttachment（dataURL + mediaType + filename）。
   * Composer 把它 push 到 attachments state 显示 thumbnail，并在 send 时
   * 拼进 sendMessage({ files }) 让模型 visually 看到图。
   */
  onAttachmentAdd: (attachment: PendingAttachment) => void;
  /**
   * Triggered when the user picks the "Attach skill" entry. Composer opens
   * the SkillPicker submenu in response. Wired separately from
   * `onAttachmentAdd` because skill attachments carry a different shape
   * (Attachment v2 — id/name/type/content) and don't go through R2 upload.
   */
  onAttachSkillRequested: () => void;
}

interface OptionDef {
  id: string;
  labelKey: DictKey;
  icon: React.ReactNode;
  enabled: boolean;
}

const OPTIONS: OptionDef[] = [
  {
    id: 'attachSkill',
    labelKey: 'import.option.attachSkill',
    icon: <IconSparkle />,
    enabled: true,
  },
  {
    id: 'codebase',
    labelKey: 'import.option.localCodebase',
    icon: <IconFolder />,
    enabled: false,
  },
  { id: 'github', labelKey: 'import.option.github', icon: <IconLink />, enabled: false },
  { id: 'figma', labelKey: 'import.option.figma', icon: <IconGlobe />, enabled: false },
  {
    id: 'upload',
    labelKey: 'import.option.uploadScreenshots',
    icon: <IconPaperclip />,
    enabled: true,
  },
  {
    id: 'browse',
    labelKey: 'import.option.designSystems',
    icon: <IconSparkle />,
    enabled: false,
  },
];

const Popover = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 260px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 10px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 6px;
  z-index: 50;
  font-size: 12.5px;
`;

const Row = styled.button<{ $enabled: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  text-align: left;
  cursor: ${(p) => (p.$enabled ? 'pointer' : 'not-allowed')};
  color: ${(p) => (p.$enabled ? p.theme.colors.fg100 : p.theme.colors.fg400)};
  font-family: inherit;
  font-size: 12.5px;
  position: relative;
  &:hover {
    background: ${(p) => (p.$enabled ? p.theme.colors.bg200 : 'transparent')};
  }
`;

const ComingSoon = styled.span`
  margin-left: auto;
  font-size: 10px;
  font-family: ${(p) => p.theme.fonts.mono};
  letter-spacing: 0.4px;
  color: ${(p) => p.theme.colors.fg400};
`;

const HiddenInput = styled.input`
  display: none;
`;

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

export function ImportPopover({
  open,
  projectId,
  onClose,
  onAttachmentAdd,
  onAttachSkillRequested,
}: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        // filename：file.name 优先；空时 fallback `uploaded-<ISO>-<rand>.<ext>`
        // 跟 paste 路径 `pasted-<ISO>-<rand>.<ext>` 同模式，避免任何
        // empty-name 情况下连续选多个文件互相覆盖。
        const filename =
          file.name && file.name.trim() !== ''
            ? file.name
            : `uploaded-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.${extFromMime(file.type)}`;
        try {
          // 1. dataURL → attachment thumbnail（即时显示给 user 反馈）
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error ?? new Error('read failed'));
            reader.readAsDataURL(file);
          });
          onAttachmentAdd({
            mediaType: file.type || 'image/png',
            url: dataUrl,
            filename,
          });

          // 2. fire-and-forget R2 PUT 让 file 进 file tree（跟 paste 路径一致）
          const putUrl = buildUrl(
            `/api/projects/${encodeURIComponent(projectId)}/files/uploads/${encodeURIComponent(filename)}`,
          );
          fetch(putUrl, {
            method: 'PUT',
            headers: { 'content-type': file.type || 'application/octet-stream' },
            body: file,
          })
            .then((res) => {
              if (!res.ok) console.warn('[upload] R2 put failed', filename, res.status);
            })
            .catch((err) => console.warn('[upload] R2 put error', filename, err));
        } catch (err) {
          console.warn('[upload] read error', filename, err);
        }
      }
      onClose();
    },
    [onAttachmentAdd, onClose, projectId],
  );

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  if (!open) return null;
  return (
    <Popover ref={ref} onClick={(e) => e.stopPropagation()} role="menu">
      {OPTIONS.map((opt) => (
        <Row
          key={opt.id}
          $enabled={opt.enabled}
          disabled={!opt.enabled}
          onClick={() => {
            if (!opt.enabled) return;
            if (opt.id === 'upload') triggerFilePicker();
            if (opt.id === 'attachSkill') {
              // Hand off to Composer — it opens the SkillPicker submenu and
              // tears this popover down. We don't call onClose here because
              // Composer manages both menus' visibility (the popover stays
              // hidden behind the skill submenu).
              onAttachSkillRequested();
            }
          }}
          title={opt.enabled ? undefined : t('import.comingSoon')}
          role="menuitem"
        >
          {opt.icon}
          <span>{t(opt.labelKey)}</span>
          {!opt.enabled && <ComingSoon>{t('import.soonBadge')}</ComingSoon>}
        </Row>
      ))}
      <HiddenInput
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleUpload(e.target.files)}
      />
    </Popover>
  );
}
