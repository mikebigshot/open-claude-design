import styled from 'styled-components';
import { useT } from '@/i18n';
import { ApiKeyForm } from './ApiKeyForm';

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
`;

const ModalBox = styled.div`
  background: ${({ theme }) => theme.colors.bg100};
  border-radius: 12px;
  padding: 24px;
  width: 460px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
`;

const Title = styled.h2`
  margin: 0;
  font-size: 20px;
  font-weight: 600;
`;

const Subtitle = styled.p`
  margin: 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.fg300};
`;

export interface ApiKeyModalProps {
  open: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}

export function ApiKeyModal({ open, onSaved, onCancel }: ApiKeyModalProps) {
  const t = useT();
  if (!open) return null;
  return (
    <Backdrop onClick={onCancel}>
      <ModalBox onClick={(e) => e.stopPropagation()}>
        <Title>{t('settings.modalTitle')}</Title>
        <Subtitle>{t('settings.modalSubtitle')}</Subtitle>
        <ApiKeyForm onSaved={onSaved} />
      </ModalBox>
    </Backdrop>
  );
}
