// Composer: textarea + chips + Add context + paperclip / mic / Model dropdown
// / Send. Mirrors prototype `proto-chat.jsx` composer footer.
//
// Controlled component: caller owns input state via `value` / `onChange`.
// (useChat v6 dropped managed input; ChatPanel holds external useState.)
//
// Keyboard: cmd+Enter / ctrl+Enter sends. Plain Enter inserts a newline so
// users can compose multi-paragraph prompts.

import { useCallback, useState } from 'react';
import styled from 'styled-components';
import type { ChatModel } from '@open-design/contracts';
import { useT } from '@/i18n';
import { buildUrl } from '@/lib/api';
import type { PendingAttachment } from '@/state/types';
import { IconArrowUp, IconMic, IconPaperclip, IconPlus } from './icons';
import { ImportPopover } from './ImportPopover';
import { loadStoredModel, ModelDropdown } from './ModelDropdown';
import type { ChipPrim } from './types';

// Map IANA mime → file extension. Covers the common image types a paste
// would ever produce on macOS / Windows / Linux clipboards. Defaults to
// `png` when unknown — clipboard image data without a recognized type is
// almost always a PNG screenshot.
function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'image/bmp':
      return 'bmp';
    default:
      return 'png';
  }
}

export interface ComposerProps {
  projectId: string;
  /** Controlled text value. */
  value: string;
  /** Called on every keystroke. */
  onChange: (value: string) => void;
  /**
   * Called when user submits (Send button or cmd+Enter).
   * Receives the local attachments accumulated via Cmd+V paste so the caller
   * can forward them as Vercel AI SDK FileUIParts. Composer clears its own
   * attachment state immediately after invoking onSubmit.
   */
  onSubmit: (attachments: PendingAttachment[]) => void;
  /** Called when user presses Stop during streaming. */
  onStop?: () => void;
  /** Whether the agent is currently streaming (disables Send, shows Stop). */
  streaming?: boolean;
  // ── optional extras (used by standalone / storybook renders) ──
  chips?: ChipPrim[];
  model?: ChatModel;
  onChipsChange?: (chips: ChipPrim[]) => void;
  onModelChange?: (model: ChatModel) => void;
}

const Wrap = styled.div`
  position: relative;
  padding: 12px 16px 14px;
  border-top: 1px solid ${(p) => p.theme.colors.line100};
  background: ${(p) => p.theme.colors.bg50};
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  background: ${(p) => p.theme.colors.brandTint};
  border: 1px solid ${(p) => p.theme.colors.brandSoft};
  color: ${(p) => p.theme.colors.brandPress};
  font-family: inherit;
`;

const ChipButton = styled.button`
  background: ${(p) => p.theme.colors.brandTint};
  border: 1px dashed ${(p) => p.theme.colors.brandSoft};
  color: ${(p) => p.theme.colors.brandPress};
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-family: inherit;
  &:hover {
    background: ${(p) => p.theme.colors.brandSoft};
  }
`;

const ChipClose = styled.span`
  margin-left: 2px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0.6;
  &:hover {
    opacity: 1;
  }
`;

// Paste-image preview chip. Sits in its own row above the text area so a few
// thumbnails can wrap without colliding with the import-popover Chips.
// Size matches claude.ai/design original (~56×72 portrait, 4:5 ratio) so
// users can actually see what they pasted, not a 36×36 blob.
const AttachmentChip = styled.span`
  position: relative;
  display: inline-block;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid ${(p) => p.theme.colors.line100};
  background: ${(p) => p.theme.colors.bg100};
  & > img {
    width: 56px;
    height: 72px;
    object-fit: cover;
    display: block;
  }
`;

const AttachmentClose = styled.button`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: none;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  &:hover {
    background: rgba(0, 0, 0, 0.8);
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  min-height: 64px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font-family: ${(p) => p.theme.fonts.sans};
  font-size: 13.5px;
  color: ${(p) => p.theme.colors.fg100};
  line-height: 1.55;
  padding: 0;
  &::placeholder {
    color: ${(p) => p.theme.colors.fg400};
  }
`;

const FooterRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
`;

const GhostButton = styled.button`
  padding: 5px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: ${(p) => p.theme.colors.fg300};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  &:hover:not(:disabled) {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg100};
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const Spacer = styled.div`
  flex: 1;
`;

const SendButton = styled.button<{ $disabled: boolean }>`
  padding: 5px 9px;
  background: ${(p) => (p.$disabled ? p.theme.colors.bg300 : p.theme.colors.brandBase)};
  color: ${(p) => (p.$disabled ? p.theme.colors.fg400 : '#fff')};
  border: none;
  border-radius: 8px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: inherit;
  font-size: 12px;
  &:hover {
    background: ${(p) => (p.$disabled ? p.theme.colors.bg300 : p.theme.colors.brandHover)};
  }
`;

const StopButton = styled.button`
  padding: 5px 9px;
  background: ${(p) => p.theme.colors.bg300};
  color: ${(p) => p.theme.colors.fg200};
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: inherit;
  font-size: 12px;
  &:hover {
    background: ${(p) => p.theme.colors.bg200};
  }
`;

export function Composer({
  projectId,
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  chips = [],
  model = loadStoredModel(),
  onChipsChange,
  onModelChange,
}: ComposerProps) {
  const t = useT();
  const [importOpen, setImportOpen] = useState(false);

  // Attachments accumulated from Cmd+V paste in the textarea. We keep this
  // state local (caller doesn't need to drive paste) and hand it to onSubmit
  // at send time so ChatPanel can map → Vercel AI SDK FileUIParts. We clear
  // immediately on submit — stale attachments must not leak to the next msg.
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const removeChip = useCallback(
    (id: string) => {
      onChipsChange?.(chips.filter((c) => c.id !== id));
    },
    [chips, onChipsChange],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
      if (!imageItem) return; // 让纯文本粘贴正常工作
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read clipboard image failed'));
        reader.readAsDataURL(file);
      });
      // 计算最终 filename：有真实 file.name 直接用；没有就 fallback 到
      // pasted-<ISO>-<rand> —— ISO 时间戳同秒内多张 paste 会撞名（D1
      // path 是 unique key，R2 PUT 互相覆盖），所以再叠 6 位 random hex。
      const mediaType = file.type || 'image/png';
      const hasName = file.name && file.name.trim() !== '';
      const filename = hasName
        ? file.name
        : (() => {
            const rand = Math.random().toString(36).slice(2, 8);
            const iso = new Date().toISOString().replace(/[:.]/g, '-');
            return `pasted-${iso}-${rand}.${extFromMime(mediaType)}`;
          })();
      setAttachments((prev) => [
        ...prev,
        {
          mediaType,
          url: dataUrl,
          filename,
        },
      ]);
      // Fire-and-forget R2 dual-write：让 file 也进 project file tree
      // （D1 元数据 + R2 内容），跟 claude.ai/design 行为对齐。**不 await**
      // —— paste UX 的 thumbnail / send 必须立即可用，R2 PUT 失败也不影响
      // 当前 message 把 inline dataURL 发给模型。
      fetch(
        buildUrl(
          `/api/projects/${encodeURIComponent(projectId)}/files/uploads/${encodeURIComponent(filename)}`,
        ),
        {
          method: 'PUT',
          body: file,
          headers: { 'content-type': mediaType },
        },
      )
        .then((res) => {
          if (!res.ok) console.warn('[paste] R2 upload failed', res.status);
        })
        .catch((err) => {
          console.warn('[paste] R2 upload error', err);
        });
    },
    [projectId],
  );

  // Submit must be enabled with text only — pasted attachments alone don't
  // count (matches PreviewPanel Draw flow which also requires a text note).
  // This keeps "what gets sent to the model" predictable.
  const trimmed = value.trim();
  const sendDisabled = trimmed.length === 0 || !!streaming;

  const handleSubmit = useCallback(() => {
    onSubmit(attachments);
    setAttachments([]);
  }, [attachments, onSubmit]);

  return (
    <Wrap>
      {chips.length > 0 && (
        <ChipRow>
          {chips.map((c) => (
            <Chip key={c.id}>
              {c.label}
              <ChipClose
                onClick={() => removeChip(c.id)}
                aria-label={t('chat.removeAria', { name: c.label })}
              >
                ×
              </ChipClose>
            </Chip>
          ))}
        </ChipRow>
      )}
      <ChipRow>
        <ChipButton
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setImportOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={importOpen}
        >
          <IconPlus size={11} /> {t('chat.addContext')}
        </ChipButton>
      </ChipRow>

      <ImportPopover
        open={importOpen}
        projectId={projectId}
        onClose={() => setImportOpen(false)}
        onAttachmentAdd={(a) => {
          setAttachments((prev) => [...prev, a]);
          setImportOpen(false);
        }}
      />

      {attachments.length > 0 && (
        <ChipRow>
          {attachments.map((a, i) => (
            <AttachmentChip key={i}>
              <img src={a.url} alt={a.filename ?? 'pasted'} />
              <AttachmentClose
                type="button"
                onClick={() =>
                  setAttachments((prev) => prev.filter((_, j) => j !== i))
                }
                aria-label={`Remove ${a.filename ?? 'attachment'}`}
              >
                ×
              </AttachmentClose>
            </AttachmentChip>
          ))}
        </ChipRow>
      )}

      <TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!sendDisabled) handleSubmit();
          }
        }}
        placeholder={t('chat.composerPlaceholder')}
        aria-label={t('chat.composerAria')}
      />

      <FooterRow>
        {/* Attach + Voice are V2 — file uploads land via the "Add context"
            popover above; voice transcription needs Web Speech API plumbing
            we haven't built. Keep the icons in place for layout stability
            but disable + tooltip them as "Coming soon". */}
        <GhostButton
          type="button"
          title={t('chat.attachComingSoon')}
          aria-label={t('chat.attachAria')}
          disabled
        >
          <IconPaperclip size={14} />
        </GhostButton>
        <GhostButton
          type="button"
          title={t('chat.voiceComingSoon')}
          aria-label={t('chat.voiceAria')}
          disabled
        >
          <IconMic size={14} />
        </GhostButton>
        <Spacer />
        {onModelChange && <ModelDropdown model={model as ChatModel} onChange={onModelChange} />}
        {streaming && onStop ? (
          <StopButton type="button" onClick={onStop} aria-label={t('chat.stop')}>
            ◼ {t('chat.stop')}
          </StopButton>
        ) : (
          <SendButton
            type="button"
            $disabled={sendDisabled}
            disabled={sendDisabled}
            onClick={handleSubmit}
            aria-label={t('chat.send')}
          >
            <IconArrowUp size={14} />
          </SendButton>
        )}
      </FooterRow>
    </Wrap>
  );
}
