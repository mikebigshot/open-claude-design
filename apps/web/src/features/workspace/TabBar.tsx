// 文件 tab 栏 —— Design Files + 多个文件 tab，可关闭可切换

import styled from 'styled-components';

import { useT } from '@/i18n';
import { useWorkspace } from '@/state/workspace';
import { DESIGN_FILES_TAB, PREVIEW_TAB } from '@/state/types';

import { CloseIcon, FileTabIcon } from './icons';

const Bar = styled.div`
  flex: 1;
  display: flex;
  align-items: stretch;
  overflow: auto;
  scrollbar-width: thin;
`;

const Tab = styled.div<{ $active: boolean }>`
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-right: 1px solid ${(p) => p.theme.colors.line100};
  background: ${(p) => (p.$active ? p.theme.colors.bg50 : 'transparent')};
  font-size: 12px;
  color: ${(p) => (p.$active ? p.theme.colors.fg100 : p.theme.colors.fg400)};
  cursor: pointer;
  position: relative;
  white-space: nowrap;
  user-select: none;
  transition:
    background 0.14s,
    color 0.14s;

  &:hover {
    color: ${(p) => p.theme.colors.fg100};
  }
`;

const ActiveBar = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: ${(p) => p.theme.colors.bg50};
`;

const CloseBtn = styled.button`
  margin-left: 4px;
  color: ${(p) => p.theme.colors.fg400};
  font-size: 12px;
  padding: 0 4px;
  border-radius: 3px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  font-family: inherit;

  &:hover {
    background: ${(p) => p.theme.colors.bg300};
    color: ${(p) => p.theme.colors.fg200};
  }
`;

export function TabBar() {
  const t = useT();
  const { state, actions } = useWorkspace();
  const { openTabs, activeTab } = state;

  return (
    <Bar role="tablist" aria-label={t('workspace.tab.openFilesAria')}>
      <Tab
        role="tab"
        aria-selected={activeTab === DESIGN_FILES_TAB}
        $active={activeTab === DESIGN_FILES_TAB}
        onClick={() => actions.setActiveTab(DESIGN_FILES_TAB)}
        data-testid="tab-design-files"
        data-active={activeTab === DESIGN_FILES_TAB ? 'true' : 'false'}
      >
        <FileTabIcon />
        <span>{t('workspace.tab.designFiles')}</span>
        {activeTab === DESIGN_FILES_TAB && <ActiveBar />}
      </Tab>
      <Tab
        role="tab"
        aria-selected={activeTab === PREVIEW_TAB}
        $active={activeTab === PREVIEW_TAB}
        onClick={() => actions.setActiveTab(PREVIEW_TAB)}
        data-testid="tab-preview"
        data-active={activeTab === PREVIEW_TAB ? 'true' : 'false'}
      >
        <FileTabIcon />
        <span>{t('workspace.tab.preview')}</span>
        {activeTab === PREVIEW_TAB && <ActiveBar />}
      </Tab>
      {openTabs.map((name) => (
        <Tab
          key={name}
          role="tab"
          aria-selected={activeTab === name}
          $active={activeTab === name}
          onClick={() => actions.setActiveTab(name)}
          data-testid={`tab-file-${name}`}
          data-active={activeTab === name ? 'true' : 'false'}
        >
          <FileTabIcon />
          <span>{name}</span>
          <CloseBtn
            type="button"
            aria-label={t('workspace.tab.closeAria', { name })}
            onClick={(e) => {
              e.stopPropagation();
              actions.closeTab(name);
            }}
            data-testid={`tab-close-${name}`}
          >
            <CloseIcon />
          </CloseBtn>
          {activeTab === name && <ActiveBar />}
        </Tab>
      ))}
    </Bar>
  );
}
