// 项目类型 4 tab —— Prototype / Slide deck / From template / Other
// MVP 仅 prototype 可用，其他 disabled。

import styled from 'styled-components';

import type { ProjectType } from '@open-design/contracts';
import { useT } from '@/i18n';

type DictKey = Parameters<ReturnType<typeof useT>>[0];

interface TypeOption {
  labelKey: DictKey;
  value: ProjectType;
  enabled: boolean;
}

const TYPES: TypeOption[] = [
  { labelKey: 'home.typePicker.prototype', value: 'prototype', enabled: true },
  { labelKey: 'home.typePicker.slideDeck', value: 'slide_deck', enabled: false },
  { labelKey: 'home.typePicker.fromTemplate', value: 'other', enabled: false },
  { labelKey: 'home.typePicker.other', value: 'other', enabled: false },
];

interface TypePickerProps {
  value: ProjectType;
  onChange: (value: ProjectType) => void;
}

const Row = styled.div`
  display: flex;
  gap: 12px;
  margin-bottom: 22px;
  border-bottom: 1px solid ${(p) => p.theme.colors.line100};
`;

const Tab = styled.button<{ $active: boolean; $disabled: boolean }>`
  padding: 0 0 8px;
  font-size: 11.5px;
  background: transparent;
  border: none;
  border-bottom: 2px solid ${(p) => (p.$active ? p.theme.colors.fg100 : 'transparent')};
  margin-bottom: -1px;
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  color: ${(p) =>
    p.$disabled ? p.theme.colors.fg500 : p.$active ? p.theme.colors.fg100 : p.theme.colors.fg300};
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  white-space: nowrap;
  font-family: inherit;
  transition:
    color 0.14s,
    border-color 0.14s;

  &:hover {
    color: ${(p) => (p.$disabled ? p.theme.colors.fg500 : p.theme.colors.fg100)};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

export function TypePicker({ value, onChange }: TypePickerProps) {
  const t = useT();
  return (
    <Row role="tablist" aria-label="Project type">
      {TYPES.map((opt) => (
        <Tab
          key={opt.labelKey}
          type="button"
          role="tab"
          aria-selected={value === opt.value && opt.enabled}
          aria-disabled={!opt.enabled}
          $active={opt.enabled && value === opt.value}
          $disabled={!opt.enabled}
          disabled={!opt.enabled}
          title={opt.enabled ? undefined : t('common.comingSoon')}
          onClick={() => opt.enabled && onChange(opt.value)}
        >
          {t(opt.labelKey)}
        </Tab>
      ))}
    </Row>
  );
}
