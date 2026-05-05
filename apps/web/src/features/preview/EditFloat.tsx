// EditFloat — Edit-mode inspector panel.
//
// Background swatches, font dropdown, body and heading size sliders. Changes
// are dispatched as `EDIT_STYLE { property, value }` postMessages to the
// iframe so the overlay can apply them with `pinned.style.setProperty(...)`.
//
// This component is presentational only — it reads the current style state
// from props and emits updates via the onStyleChange / onEditChange
// callbacks. The parent (`PreviewPanel`) maps those into both the local
// workspace state (so the preview's surroundings react) and an `EDIT_STYLE`
// postMessage to the iframe.

import { useId } from 'react';
import styled from 'styled-components';
import { FloatPanel } from '@/components/FloatPanel';
import { useT } from '@/i18n';
import type { EditState } from '@/state/types';

export interface EditFloatProps {
  edit: EditState;
  /** Selected element (after click). When null, panel shows hint instead of
   *  bound controls. */
  selection: EditSelectionSummary | null;
  /** Update local edit state (drives FintechPreview tokens / page bg). */
  onEditChange: (partial: Partial<EditState>) => void;
  /**
   * Apply a style override to the currently pinned element in the iframe via
   * EDIT_STYLE. Called for every slider tick / picker change to feel live.
   */
  onStyleChange: (property: string, value: string) => void;
}

/** Subset of element info the parent surfaces to the inspector. */
export interface EditSelectionSummary {
  tag: string;
  selector: string;
  /**
   * Original outerHTML (≤ 600 bytes — overlay truncates) used as the anchor
   * to locate the element back in source files when persisting style edits.
   */
  outerHTML: string;
  styles?: Record<string, string>;
}

const Row = styled.div`
  margin-bottom: 10px;

  &:last-child {
    margin-bottom: 0;
  }
`;

const RowLabel = styled.div`
  font-size: 11px;
  color: ${(p) => p.theme.colors.fg400};
  margin-bottom: 4px;
`;

const Hint = styled.div`
  font-size: 11px;
  color: ${(p) => p.theme.colors.fg400};
  margin-bottom: 8px;
  line-height: 1.5;
`;

const SelectionTag = styled.strong`
  color: ${(p) => p.theme.colors.fg200};
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 11px;
`;

const SwatchRow = styled.div`
  display: flex;
  gap: 4px;
`;

const Swatch = styled.button<{ $color: string; $selected: boolean }>`
  width: 28px;
  height: 24px;
  border-radius: 4px;
  background: ${(p) => p.$color};
  border: ${(p) =>
    p.$selected ? `2px solid ${p.theme.colors.brandBase}` : `1px solid ${p.theme.colors.line200}`};
  cursor: pointer;
  padding: 0;
`;

const Select = styled.select`
  width: 100%;
  padding: 5px 8px;
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 4px;
  font-size: 12px;
  background: ${(p) => p.theme.colors.bg50};
  color: ${(p) => p.theme.colors.fg200};
  font-family: ${(p) => p.theme.fonts.sans};
`;

const Slider = styled.input`
  width: 100%;
`;

const BG_SWATCHES = ['#FAF9F5', '#FFFFFF', '#141413', '#F3E7DF'] as const;
const FONT_OPTIONS = ['Inter', 'Instrument Serif', 'JetBrains Mono', 'Georgia'] as const;

export function EditFloat({ edit, selection, onEditChange, onStyleChange }: EditFloatProps) {
  const t = useT();
  const fontId = useId();
  const showSelection = Boolean(selection);

  return (
    <div data-testid="edit-float" data-has-selection={showSelection ? 'true' : 'false'}>
      <FloatPanel title={t('editFloat.title')} width={260}>
        <Hint>
          {showSelection && selection ? (
            <>
              {t('editFloat.showing')}
              <SelectionTag data-testid="edit-float-selection-tag">{selection.tag}</SelectionTag>
            </>
          ) : (
            <>
              Click anywhere in the preview to inspect. {t('editFloat.showing')}
              <SelectionTag data-testid="edit-float-selection-tag">
                {t('editFloat.pageDefault')}
              </SelectionTag>
            </>
          )}
        </Hint>

        <Row>
          <RowLabel>{t('editFloat.background')}</RowLabel>
          <SwatchRow data-testid="edit-float-bg-row">
            {BG_SWATCHES.map((color) => (
              <Swatch
                key={color}
                type="button"
                data-testid={`edit-float-bg-${color}`}
                $color={color}
                $selected={edit.bg === color}
                onClick={() => {
                  onEditChange({ bg: color });
                  if (selection) onStyleChange('background-color', color);
                }}
                aria-label={`${t('editFloat.background')} ${color}`}
              />
            ))}
          </SwatchRow>
        </Row>

        <Row>
          <RowLabel>{t('editFloat.fontFamily')}</RowLabel>
          <Select
            id={fontId}
            data-testid="edit-float-font"
            value={edit.font}
            onChange={(event) => {
              const next = event.target.value;
              onEditChange({ font: next });
              if (selection) onStyleChange('font-family', next);
            }}
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </Select>
        </Row>

        <Row>
          <RowLabel>{`${t('editFloat.bodySize')} · ${edit.base}px`}</RowLabel>
          <Slider
            type="range"
            data-testid="edit-float-body-size"
            min={12}
            max={20}
            value={edit.base}
            onChange={(event) => {
              const next = Number(event.target.value);
              onEditChange({ base: next });
              if (selection) onStyleChange('font-size', `${next}px`);
            }}
            aria-label={t('editFloat.bodySize')}
          />
        </Row>

        <Row>
          <RowLabel>{`${t('editFloat.headingSize')} · ${edit.headingSize}px`}</RowLabel>
          <Slider
            type="range"
            data-testid="edit-float-heading-size"
            min={18}
            max={42}
            value={edit.headingSize}
            onChange={(event) => {
              onEditChange({ headingSize: Number(event.target.value) });
            }}
            aria-label={t('editFloat.headingSize')}
          />
        </Row>
      </FloatPanel>
    </div>
  );
}
