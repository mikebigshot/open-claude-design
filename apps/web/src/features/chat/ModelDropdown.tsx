// Model picker dropdown — multi-provider.
//
// Single source of truth for the option list lives in
// `@open-design/contracts` (`MODELS` constant, each tagged with provider).
// Selection persists `(provider, modelId)` to localStorage via
// `lib/model-pref` and broadcasts via `lib/model-pref-events` so ChatPanel
// + use-agent-chat re-create the agent on switch (same tab + cross tab).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import {
  MODELS,
  PROVIDERS,
  PROVIDER_LABELS,
  type ChatModel,
  type LLMProvider,
} from '@open-design/contracts';
import { byokKey } from '@/lib/byok-key';
import { useT } from '@/i18n';
import { getModelPref, setModelPref } from '@/lib/model-pref';
import { emitModelChange, subscribeModelChange } from '@/lib/model-pref-events';
import { IconChevron, IconCheck, IconSparkle } from './icons';

interface Props {
  /**
   * Optional controlled model. If not provided the dropdown reads from
   * localStorage and updates itself via subscribeModelChange.
   */
  model?: ChatModel;
  onChange?: (model: ChatModel) => void;
}

// Re-export the canonical option list for any callers that still want it.
export const MODEL_OPTIONS = MODELS;

/**
 * Read the currently-stored model id. Kept as a named export so other
 * modules can read at call-time (e.g. agent factories).
 */
export function loadStoredModel(): ChatModel {
  return getModelPref().modelId;
}

/** Persist the user's model + provider choice and notify subscribers. */
export function persistModel(provider: LLMProvider, modelId: string): void {
  setModelPref({ provider, modelId });
  emitModelChange();
}

const Wrap = styled.div`
  position: relative;
`;

const TriggerButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  font-size: 11.5px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: ${(p) => p.theme.colors.fg300};
  cursor: pointer;
  font-family: inherit;
  &:hover {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg100};
  }
`;

const Menu = styled.div`
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  width: 240px;
  max-height: 360px;
  overflow-y: auto;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 8px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 4px;
  z-index: 50;
  font-size: 12px;
`;

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 4px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${(p) => p.theme.colors.fg300};
`;

const GroupHint = styled.span`
  font-size: 10px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: #c0392b;
`;

const MenuItem = styled.div<{ $disabled: boolean }>`
  padding: 6px 10px;
  border-radius: 4px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: ${(p) => (p.$disabled ? p.theme.colors.fg300 : p.theme.colors.fg100)};
  opacity: ${(p) => (p.$disabled ? 0.55 : 1)};
  &:hover {
    background: ${(p) => (p.$disabled ? 'transparent' : p.theme.colors.bg200)};
  }
`;

export function ModelDropdown({ model: modelProp, onChange }: Props) {
  const t = useT();
  // Maintain local state so the trigger label updates the moment the user
  // picks a new model — even when the parent doesn't pass a `model` prop.
  // Initial value comes from prop > localStorage > default.
  const [model, setModel] = useState<ChatModel>(() => modelProp ?? getModelPref().modelId);
  const [open, setOpen] = useState(false);
  // Bumped on storage events so disabled/enabled state per provider rerenders
  // when the user adds/removes a key in another component.
  const [keyTick, setKeyTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Mirror prop changes (controlled mode).
  useEffect(() => {
    if (modelProp) setModel(modelProp);
  }, [modelProp]);

  // Subscribe to model-change events so cross-tab + sibling-component changes
  // refresh the trigger label without a remount. Also bump keyTick so the
  // per-provider "no key" hints stay accurate after a Save in ApiKeyForm.
  useEffect(() => {
    return subscribeModelChange(() => {
      setModel(getModelPref().modelId);
      setKeyTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Re-evaluate per-provider key presence on every open + key change.
  // Cheap: 3 localStorage reads. Captured in useMemo so render is stable.
  const providersWithKey = useMemo(() => {
    void keyTick;
    void open;
    const m: Partial<Record<LLMProvider, boolean>> = {};
    for (const p of PROVIDERS) m[p] = byokKey.isSet(p);
    return m as Record<LLMProvider, boolean>;
  }, [keyTick, open]);

  const handleChoose = useCallback(
    (provider: LLMProvider, next: ChatModel) => {
      setModelPref({ provider, modelId: next });
      setModel(next);
      onChange?.(next);
      emitModelChange();
      setOpen(false);
    },
    [onChange],
  );

  const currentLabel =
    MODELS.find((o) => o.id === model)?.label ?? MODELS[0]?.label ?? 'Sonnet 4.6';

  return (
    <Wrap ref={wrapRef}>
      <TriggerButton
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="model-dropdown-trigger"
      >
        <IconSparkle size={12} />
        {currentLabel}
        <IconChevron size={12} />
      </TriggerButton>
      {open && (
        <Menu role="listbox" onClick={(e) => e.stopPropagation()} data-testid="model-dropdown-menu">
          {PROVIDERS.map((provider) => {
            const items = MODELS.filter((m) => m.provider === provider);
            if (items.length === 0) return null;
            const hasKey = providersWithKey[provider];
            return (
              <div key={provider}>
                <GroupHeader>
                  <span>{PROVIDER_LABELS[provider]}</span>
                  {!hasKey && <GroupHint>{t('modelDropdown.noKey')}</GroupHint>}
                </GroupHeader>
                {items.map((opt) => (
                  <MenuItem
                    key={`${provider}::${opt.id}`}
                    role="option"
                    aria-selected={opt.id === model}
                    aria-disabled={!hasKey}
                    $disabled={!hasKey}
                    onClick={() => {
                      if (!hasKey) return;
                      handleChoose(provider, opt.id);
                    }}
                    data-testid={`model-option-${provider}-${opt.id}`}
                    title={
                      hasKey
                        ? undefined
                        : t('modelDropdown.addKeyFirst', { provider: PROVIDER_LABELS[provider] })
                    }
                  >
                    <span>{opt.label}</span>
                    {opt.id === model && <IconCheck size={12} />}
                  </MenuItem>
                ))}
              </div>
            );
          })}
        </Menu>
      )}
    </Wrap>
  );
}
