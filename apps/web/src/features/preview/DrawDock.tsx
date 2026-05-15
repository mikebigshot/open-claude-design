// DrawDock — bottom-center floating toolbar for the Draw mode.
//
// Displays sub-mode toggles (Draw / Point / Voice) plus stroke counter and
// Undo / Discard / Send buttons. Voice is disabled with a "Coming soon"
// tooltip.
//
// A free-form note textarea sits between the sub-mode toggles and the action
// buttons. The note travels back to PreviewPanel.sendDraw via onNoteChange
// and becomes the chat-submit text (instead of a synthesized "Annotated
// screenshot with N marks" string).

import styled from 'styled-components';
import { IconArrowUp, IconCursor, IconMic, IconPen, IconUndo } from '@/components/Icon';
import { useT } from '@/i18n';
import type { DrawSubMode } from '@/state/types';

export interface DrawDockProps {
  subMode: DrawSubMode;
  strokeCount: number;
  /** Free-form note typed by the user — becomes the chat-submit text on Send. */
  note: string;
  /** Controlled-input handler for the note textarea. */
  onNoteChange: (next: string) => void;
  onSubModeChange: (mode: DrawSubMode) => void;
  onUndo: () => void;
  onDiscard: () => void;
  onSend: () => void;
  /** Disabled state for Send (e.g. while a chat request is in flight). */
  sendDisabled?: boolean;
}

const Dock = styled.div`
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 999px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  z-index: 50;
  font-family: ${(p) => p.theme.fonts.sans};
`;

const SubModeBtn = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 11.5px;
  border-radius: 999px;
  cursor: pointer;
  font-family: ${(p) => p.theme.fonts.sans};
  font-weight: 500;
  border: 1px solid ${(p) => (p.$active ? p.theme.colors.brandBase : 'transparent')};
  background: ${(p) => (p.$active ? p.theme.colors.brandBase : 'transparent')};
  color: ${(p) => (p.$active ? '#fff' : p.theme.colors.fg200)};

  &:hover:not(:disabled) {
    background: ${(p) => (p.$active ? p.theme.colors.brandHover : p.theme.colors.bg200)};
  }

  &:disabled {
    color: ${(p) => p.theme.colors.fg400};
    cursor: not-allowed;
  }
`;

const IconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  color: ${(p) => p.theme.colors.fg300};

  &:hover:not(:disabled) {
    background: ${(p) => p.theme.colors.bg200};
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const TextBtn = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 11.5px;
  border-radius: 999px;
  cursor: pointer;
  font-family: ${(p) => p.theme.fonts.sans};
  font-weight: 500;
  background: ${(p) => (p.$primary ? p.theme.colors.brandBase : 'transparent')};
  color: ${(p) => (p.$primary ? '#fff' : p.theme.colors.fg200)};
  border: 1px solid ${(p) => (p.$primary ? p.theme.colors.brandBase : 'transparent')};

  &:hover:not(:disabled) {
    background: ${(p) => (p.$primary ? p.theme.colors.brandHover : p.theme.colors.bg200)};
  }
  &:disabled {
    background: ${(p) => (p.$primary ? '#edc8b7' : 'transparent')};
    border-color: ${(p) => (p.$primary ? '#edc8b7' : 'transparent')};
    cursor: not-allowed;
  }
`;

const Divider = styled.div`
  width: 1px;
  height: 18px;
  background: ${(p) => p.theme.colors.line100};
  margin: 0 4px;
`;

const Counter = styled.span`
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 10.5px;
  color: ${(p) => p.theme.colors.fg400};
  padding: 0 6px;
`;

// NoteInput — single-line-styled textarea so the user can type a free-form
// note that travels to chat as the message text. We use textarea (not input)
// so multi-line paste still works; height is clamped via `rows={1}` and CSS
// resize:none to keep the dock compact. Width is generous (260px) so a 6-8
// word phrase fits without truncation.
const NoteInput = styled.textarea`
  width: 260px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font-family: ${(p) => p.theme.fonts.sans};
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg100};
  padding: 4px 8px;
  border-radius: 6px;
  line-height: 1.4;
  /* match SubModeBtn vertical alignment in the dock */
  height: 22px;

  &::placeholder {
    color: ${(p) => p.theme.colors.fg400};
  }

  &:focus {
    background: ${(p) => p.theme.colors.bg100};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

export function DrawDock({
  subMode,
  strokeCount,
  note,
  onNoteChange,
  onSubModeChange,
  onUndo,
  onDiscard,
  onSend,
  sendDisabled = false,
}: DrawDockProps) {
  const t = useT();
  return (
    <Dock data-testid="draw-dock">
      <SubModeBtn
        type="button"
        data-testid="draw-submode-draw"
        data-active={subMode === 'draw' ? 'true' : 'false'}
        $active={subMode === 'draw'}
        onClick={() => onSubModeChange('draw')}
      >
        <IconPen size={12} />
        {t('drawDock.submodeDraw')}
      </SubModeBtn>
      <SubModeBtn
        type="button"
        data-testid="draw-submode-click"
        data-active={subMode === 'click' ? 'true' : 'false'}
        $active={subMode === 'click'}
        onClick={() => onSubModeChange('click')}
      >
        <IconCursor size={12} />
        {t('drawDock.submodePoint')}
      </SubModeBtn>
      {/*
        Voice submode is disabled until we ship recording. native `disabled`
        plus `aria-disabled="true"` is the WCAG-preferred announcement for
        non-interactable buttons that remain visually present (some AT combos
        ignore native disabled on styled buttons).
      */}
      <SubModeBtn
        type="button"
        data-testid="draw-submode-voice"
        $active={false}
        disabled
        aria-disabled="true"
        title={t('common.comingSoon')}
      >
        <IconMic size={12} />
        {t('drawDock.submodeVoice')}
      </SubModeBtn>

      <Divider />

      <NoteInput
        rows={1}
        data-testid="draw-note-input"
        placeholder={t('drawDock.notePlaceholder')}
        aria-label={t('drawDock.noteAria')}
        value={note}
        onChange={(e) => onNoteChange(e.currentTarget.value)}
        /*
          Enter sends instead of inserting a newline (Shift+Enter still inserts
          for power users). This matches the chat composer's affordance and is
          the natural keyboard shortcut for the primary action of the dock.
        */
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendDisabled && strokeCount > 0) onSend();
          }
        }}
      />

      <Divider />

      <Counter data-testid="draw-stroke-count">
        {t('drawDock.marksCount', { n: strokeCount })}
      </Counter>

      <IconBtn
        type="button"
        data-testid="draw-undo"
        aria-label={t('drawDock.undo')}
        onClick={onUndo}
        disabled={strokeCount === 0}
      >
        <IconUndo size={12} />
      </IconBtn>

      <TextBtn type="button" data-testid="draw-discard" onClick={onDiscard}>
        {t('drawDock.discard')}
      </TextBtn>

      <TextBtn
        type="button"
        data-testid="draw-send"
        $primary
        onClick={onSend}
        disabled={sendDisabled || strokeCount === 0}
      >
        {sendDisabled ? t('drawDock.sending') : t('drawDock.send')}
        <IconArrowUp size={12} />
      </TextBtn>
    </Dock>
  );
}
