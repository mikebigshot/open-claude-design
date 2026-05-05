// Pin list (mirrors prototype `proto-chat.jsx` CommentsTab).
//
// The Comment tool drops yellow numbered pins on the preview overlay (slice 5);
// each pin maps to one entry here. We render the empty state with the
// "Click the Comment tool..." copy when none exist.
//
// 2026-05-03 (img_3 design): each pin row now has a checkbox in the top-right
// for multi-select. When ≥1 pin is selected a bottom action bar appears with
// "Add note" + "Send to Claude" so users can batch comments into a single
// chat message.

import { useState } from 'react';
import styled from 'styled-components';
import { useT } from '@/i18n';
import { IconClose } from './icons';
import type { Pin } from './types';

type TFn = ReturnType<typeof useT>;

interface Props {
  pins: Pin[];
  /** Delete by stable id (n is just a display number; not unique after deletes). */
  onDelete?: (id: string) => void;
  /**
   * Click a pin row → caller switches the active file (if known) and asks
   * PreviewPanel to scroll the pin into view.
   */
  onSelect?: (id: string, filePath?: string | null) => void;
  /**
   * Non-null = the most recent /api/projects/:id/comments fetch failed. We
   * surface a degraded UI banner so users know their pins might not be
   * complete (vs. silently showing the "no comments yet" empty state, which
   * is indistinguishable from "comments couldn't be loaded").
   */
  loadError?: string | null;
  /**
   * Currently-selected pin ids (multi-select via checkbox). When omitted the
   * checkbox UI is hidden (e.g. read-only share view).
   */
  selectedIds?: string[];
  /** Toggle a pin id in / out of `selectedIds`. */
  onToggleSelection?: (id: string) => void;
  /**
   * Aggregate the selected pins into a single chat submission. The handler is
   * responsible for building the message text from `pins` + `selectedIds` +
   * the optional note. CommentsTab calls this then clears the local note
   * input.
   */
  onSendSelected?: (note: string) => void;
}

const Empty = styled.div`
  font-size: 12.5px;
  color: ${(p) => p.theme.colors.fg400};
  padding: 16px 0;
  line-height: 1.5;
`;

const PinCard = styled.div<{ $clickable: boolean }>`
  padding: 12px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line100};
  border-radius: 10px;
  margin-bottom: 10px;
  font-size: 12.5px;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  transition:
    border-color 0.14s,
    background 0.14s;
  ${(p) =>
    p.$clickable &&
    `&:hover {
      border-color: ${p.theme.colors.line200};
      background: ${p.theme.colors.bg100};
    }`}
`;

const PinHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
`;

const PinBadge = styled.span`
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #fff7d6;
  color: #a07900;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e9c547;
`;

const PinUser = styled.strong`
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg100};
`;

const PinTime = styled.span`
  color: ${(p) => p.theme.colors.fg400};
  font-size: 11px;
`;

const DeleteButton = styled.button`
  margin-left: auto;
  padding: 2px;
  font-size: 11px;
  background: transparent;
  border: none;
  color: ${(p) => p.theme.colors.fg400};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg200};
  }
`;

const PinBody = styled.div`
  color: ${(p) => p.theme.colors.fg200};
  line-height: 1.5;
`;

const PinEmpty = styled.em`
  color: ${(p) => p.theme.colors.fg400};
`;

// Subtle inline banner — reuses the chat panel's danger-tinted style. role="alert"
// so screen readers announce it; visually understated because comments load
// failure is non-fatal (chat + preview keep working).
const ErrorNotice = styled.div`
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: ${(p) => p.theme.colors.bg200};
  border: 1px solid ${(p) => p.theme.colors.danger};
  color: ${(p) => p.theme.colors.danger};
  font-size: 12px;
  line-height: 1.5;
`;

// PinRowCheckbox — selection checkbox in the top-right of each PinCard. Sits
// at the end of the header so the visual hierarchy reads "number → user →
// time → delete → checkbox". We keep it visually subtle (no extra label
// text) — the aria-label carries the meaning for screen readers.
const PinRowCheckbox = styled.input.attrs({ type: 'checkbox' })`
  margin-left: 4px;
  cursor: pointer;
  width: 14px;
  height: 14px;
  accent-color: ${(p) => p.theme.colors.brandBase};

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

// SelectionBar — sticky-ish bottom action bar. The chat panel's Scroll
// container already overflows so we render the bar inline at the bottom of
// the list (still always visible because the user just clicked a checkbox).
const SelectionBar = styled.div`
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  box-shadow: ${(p) => p.theme.shadows.lg};
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SelectionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg200};
`;

const SelectionCount = styled.span`
  font-weight: 600;
  color: ${(p) => p.theme.colors.fg100};
`;

const SelectionSpacer = styled.div`
  flex: 1;
`;

const SelectionBtn = styled.button<{ $primary?: boolean }>`
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  background: ${(p) => (p.$primary ? p.theme.colors.brandBase : 'transparent')};
  color: ${(p) => (p.$primary ? '#fff' : p.theme.colors.fg200)};
  border: 1px solid ${(p) => (p.$primary ? p.theme.colors.brandBase : p.theme.colors.line200)};

  &:hover:not(:disabled) {
    background: ${(p) => (p.$primary ? p.theme.colors.brandHover : p.theme.colors.bg200)};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SelectionNote = styled.textarea`
  width: 100%;
  min-height: 36px;
  resize: vertical;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 12px;
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 6px;
  background: ${(p) => p.theme.colors.bg100};
  color: ${(p) => p.theme.colors.fg100};

  &::placeholder {
    color: ${(p) => p.theme.colors.fg400};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

export function CommentsTab({
  pins,
  onDelete,
  onSelect,
  loadError = null,
  selectedIds,
  onToggleSelection,
  onSendSelected,
}: Props) {
  const t = useT();
  const selectionEnabled = selectedIds !== undefined && onToggleSelection !== undefined;
  const selectedCount = selectedIds?.length ?? 0;
  // Local "open" state for the note textarea so the bottom bar starts compact.
  // Reset whenever selection drops to 0 (the bar unmounts).
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  // Error path: render the banner + (if applicable) the empty state copy that
  // hints at the degraded mode rather than the cheerful default. Pins, if any,
  // still render — failures don't have to be all-or-nothing (e.g. the post-fetch
  // optimistic add still works even if the initial GET failed).
  if (loadError && pins.length === 0) {
    return (
      <div>
        <ErrorNotice role="alert" data-testid="comments-load-error">
          {t('comments.errorLoad', { error: loadError })}
        </ErrorNotice>
        <Empty>{t('comments.errorReload')}</Empty>
      </div>
    );
  }
  if (pins.length === 0) {
    return (
      <Empty>
        <span>{t('comments.empty.intro')}</span>
        <strong>{t('comments.empty.toolName')}</strong>
        <span>{t('comments.empty.instruction')}</span>
      </Empty>
    );
  }

  const handleSend = () => {
    if (!onSendSelected) return;
    onSendSelected(note);
    // Caller is expected to dispatch clear_pin_selection — locally we still
    // tidy our own UI state so a re-selection starts from a clean slate.
    setNote('');
    setNoteOpen(false);
  };

  return (
    <div>
      {loadError ? (
        <ErrorNotice role="alert" data-testid="comments-load-error">
          {t('comments.errorPartial', { error: loadError })}
        </ErrorNotice>
      ) : null}
      {pins.map((p) => {
        const isSelected = selectedIds?.includes(p.id) ?? false;
        return (
          <PinCard
            key={p.id}
            $clickable={!!onSelect}
            onClick={onSelect ? () => onSelect(p.id, p.filePath) : undefined}
            title={onSelect ? t('commentPin.jumpTitle') : undefined}
          >
            <PinHeader>
              <PinBadge>{p.n}</PinBadge>
              <PinUser>{p.user ?? 'You'}</PinUser>
              <PinTime>{formatRelative(p.createdAt, t)}</PinTime>
              {onDelete && (
                <DeleteButton
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p.id);
                  }}
                  aria-label={t('comments.deletePinAria', { n: p.n })}
                >
                  <IconClose />
                </DeleteButton>
              )}
              {selectionEnabled && (
                <PinRowCheckbox
                  checked={isSelected}
                  aria-label={t('comments.selectPinAria', { n: p.n })}
                  data-testid={`comment-checkbox-${p.id}`}
                  onClick={(e) => {
                    // Prevent the row's onClick from firing (pin scroll-into-view).
                    e.stopPropagation();
                  }}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleSelection!(p.id);
                  }}
                />
              )}
            </PinHeader>
            <PinBody>{p.text || <PinEmpty>{t('commentPin.empty')}</PinEmpty>}</PinBody>
          </PinCard>
        );
      })}
      {selectionEnabled && selectedCount > 0 && (
        <SelectionBar role="region" aria-label="Selected comments" data-testid="selection-bar">
          <SelectionRow>
            <SelectionCount data-testid="selection-count">
              {t('comments.selectedCount', { n: selectedCount })}
            </SelectionCount>
            <SelectionSpacer />
            <SelectionBtn
              type="button"
              data-testid="selection-add-note"
              aria-pressed={noteOpen}
              onClick={() => setNoteOpen((v) => !v)}
            >
              {noteOpen ? t('comments.toggleHide') : t('comments.toggleAdd')}
            </SelectionBtn>
            <SelectionBtn
              type="button"
              data-testid="selection-send"
              $primary
              onClick={handleSend}
              disabled={!onSendSelected}
            >
              {t('comments.sendToClaude')}
            </SelectionBtn>
          </SelectionRow>
          {noteOpen && (
            <SelectionNote
              data-testid="selection-note"
              aria-label="Note for selected comments"
              placeholder={t('comments.notePlaceholder')}
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
          )}
        </SelectionBar>
      )}
    </div>
  );
}

/**
 * Aggregate the chosen pins into a single chat-message string.
 * Format (one line per pin, optional trailing note):
 *   📍 [Pin 1] .selector — pin text
 *   📍 [Pin 2] (no selector) — pin text
 *
 *   note text...
 *
 * Exported so PreviewPanel/ChatPanel can call the same formatter (single
 * source of truth for the wire format the agent will receive).
 */
export function aggregateSelectedPins(
  pins: Pin[],
  selectedIds: string[],
  note: string,
  t: TFn,
): string {
  const lookup = new Map(pins.map((p) => [p.id, p]));
  const lines: string[] = [];
  for (const id of selectedIds) {
    const pin = lookup.get(id);
    if (!pin) continue;
    const text = pin.text.trim() || t('comments.noComment');
    if (pin.selector) {
      lines.push(t('comments.aggregated', { n: pin.n, selector: `\`${pin.selector}\``, text }));
    } else {
      lines.push(t('comments.aggregatedNoSelector', { n: pin.n, text }));
    }
  }
  const trimmedNote = note.trim();
  if (trimmedNote) {
    lines.push('', trimmedNote);
  }
  return lines.join('\n');
}

function formatRelative(iso: string, t: TFn): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return t('common.justNow');
  const diff = Date.now() - dt.getTime();
  if (diff < 60_000) return t('common.justNow');
  if (diff < 3_600_000) return t('common.minutesAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('common.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  return dt.toLocaleDateString();
}
