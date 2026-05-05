// CommentPinOverlay — renders confirmed pins + the draft pin's textarea.
//
// - Confirmed pins: yellow drop shape, number label centered, position set
//   from CommentPin.x / .y.
// - Draft pin: orange brand drop shape + a textarea card with Cancel / Save
//   pin / Send to Atelier buttons.
//
// The overlay sits inside the relative-positioned preview container; the pin
// coordinates are in container-local CSS pixels.

import type { ChangeEvent } from 'react';
import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useT } from '@/i18n';
import type { CommentPin } from '@/state/types';

export interface CommentPinOverlayProps {
  pins: CommentPin[];
  drawingPin: CommentPin | null;
  onDraftChange: (next: CommentPin) => void;
  onDraftCancel: () => void;
  onSavePin: () => void;
  onSendToAtelier: () => void;
}

const ConfirmedPin = styled.div`
  position: absolute;
  pointer-events: auto;
  z-index: 20;
  width: 28px;
  height: 28px;
`;

const PinShape = styled.div<{ $variant: 'confirmed' | 'draft' }>`
  width: 28px;
  height: 28px;
  border-radius: 50% 50% 50% 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  transform: rotate(-45deg);
  box-shadow: ${(p) => p.theme.shadows.md};

  background: ${(p) => (p.$variant === 'draft' ? p.theme.colors.brandBase : '#FFD84D')};
  color: ${(p) => (p.$variant === 'draft' ? '#fff' : '#594000')};
  border: 1.5px solid ${(p) => (p.$variant === 'draft' ? p.theme.colors.brandPress : '#C9A227')};
`;

const PinNumber = styled.span`
  transform: rotate(45deg);
`;

const DraftWrapper = styled.div`
  position: absolute;
  z-index: 30;
`;

const DraftPinShape = styled(PinShape)`
  position: absolute;
  left: -14px;
  top: -28px;
`;

const DraftCard = styled.div`
  margin-left: 18px;
  margin-top: 4px;
  width: 280px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 10px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 10px;
`;

const DraftTextarea = styled.textarea`
  width: 100%;
  min-height: 60px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  font-family: ${(p) => p.theme.fonts.sans};
  color: ${(p) => p.theme.colors.fg100};
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 4px;
`;

const InlineBtn = styled.button<{ $primary?: boolean }>`
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid ${(p) => (p.$primary ? p.theme.colors.brandBase : 'transparent')};
  background: ${(p) => (p.$primary ? p.theme.colors.brandBase : 'transparent')};
  color: ${(p) => (p.$primary ? '#fff' : p.theme.colors.fg200)};
  cursor: pointer;
  font-family: ${(p) => p.theme.fonts.sans};

  &:hover {
    background: ${(p) => (p.$primary ? p.theme.colors.brandHover : p.theme.colors.bg200)};
  }
`;

export function CommentPinOverlay({
  pins,
  drawingPin,
  onDraftChange,
  onDraftCancel,
  onSavePin,
  onSendToAtelier,
}: CommentPinOverlayProps) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus the draft textarea when it appears.
  useEffect(() => {
    if (drawingPin && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [drawingPin]);

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (!drawingPin) return;
    onDraftChange({ ...drawingPin, text: event.target.value });
  };

  return (
    <>
      {pins.map((p) => (
        <ConfirmedPin
          key={p.id}
          data-pin-id={p.id}
          data-testid="comment-pin"
          data-pin-n={p.n}
          style={{ left: p.x - 14, top: p.y - 28 }}
        >
          <PinShape $variant="confirmed">
            <PinNumber>{p.n}</PinNumber>
          </PinShape>
        </ConfirmedPin>
      ))}

      {drawingPin ? (
        <DraftWrapper
          data-testid="comment-pin-draft"
          style={{ left: drawingPin.x, top: drawingPin.y }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <DraftPinShape $variant="draft">
            <PinNumber>{drawingPin.n}</PinNumber>
          </DraftPinShape>

          <DraftCard>
            <DraftTextarea
              ref={textareaRef}
              data-testid="comment-pin-textarea"
              value={drawingPin.text}
              onChange={handleDraftChange}
              placeholder={t('commentPin.placeholder')}
            />
            <ButtonRow>
              <InlineBtn type="button" data-testid="comment-pin-cancel" onClick={onDraftCancel}>
                {t('common.cancel')}
              </InlineBtn>
              <InlineBtn type="button" data-testid="comment-pin-save" onClick={onSavePin}>
                {t('commentPin.savePin')}
              </InlineBtn>
              <InlineBtn
                type="button"
                data-testid="comment-pin-send"
                $primary
                onClick={onSendToAtelier}
              >
                {t('commentPin.sendToAtelier')}
              </InlineBtn>
            </ButtonRow>
          </DraftCard>
        </DraftWrapper>
      ) : null}
    </>
  );
}
