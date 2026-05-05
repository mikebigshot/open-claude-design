// Share popover —— 用户决定 OSS 自托管路线下只做"Download project as .zip"，
// 其他 PRD §10.1.1 列的 Public link / Duplicate / Standalone HTML / PDF /
// PPTX / Canva / Handoff 全部不做（2026-05-02 用户指令）。

import { useCallback, useState } from 'react';
import styled from 'styled-components';

import { useT } from '@/i18n';
import { downloadProjectAsZip } from '@/lib/zip-export';

const Panel = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  width: 240px;
  background: ${(p) => p.theme.colors.bg100};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 10px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 8px;
  z-index: 100;
  font-family: ${(p) => p.theme.fonts.sans};
`;

const ItemBtn = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 12.5px;
  color: ${(p) => p.theme.colors.fg100};
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.14s;

  &:hover:not(:disabled) {
    background: ${(p) => p.theme.colors.bg200};
  }

  &:disabled {
    opacity: 0.6;
    cursor: wait;
  }
`;

const Status = styled.div<{ $error?: boolean }>`
  font-size: 11px;
  padding: 6px 10px;
  color: ${(p) => (p.$error ? p.theme.colors.danger : p.theme.colors.brandPress)};
`;

interface SharePopoverProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function SharePopover({ projectId, projectName, onClose }: SharePopoverProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownloadZip = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await downloadProjectAsZip(projectId, projectName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, onClose, projectId, projectName]);

  return (
    <Panel role="dialog" aria-label={t('share.aria')}>
      <ItemBtn type="button" onClick={() => void handleDownloadZip()} disabled={busy}>
        {busy ? t('share.bundling') : t('share.downloadZip')}
      </ItemBtn>
      {error && <Status $error>{error}</Status>}
    </Panel>
  );
}
