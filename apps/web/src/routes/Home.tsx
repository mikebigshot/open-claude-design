// 首页 / Create page
//   顶部 Header（logo + 副标题 + 3 tab + Research Preview badge）
//   左 rail 创建表单（4 类型 tab + 名字 + 设计系统 + 保真度卡 + Create）
//   右 main（sub-tabs + 搜索 + 项目网格）
//
// MVP 限制：
//   - 顶部 3 tab 只 Designs 实功能；Examples / Design systems 占位
//   - 类型 4 tab 只 Prototype 实功能（见 TypePicker）
//   - 设计系统下拉只 "Open Design Default" 可选

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

import type {
  CreateProjectRequest,
  Fidelity,
  ListProjectsResponse,
  Project,
  ProjectType,
} from '@open-design/contracts';

import { useT } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { importProjectFromZip } from '@/lib/zip-import';
import { LanguageMenu } from '@/components/LanguageMenu';
import { showToast } from '@/components/Toast';
// DesignSystemPicker 暂时不在表单展示（用户决定 2026-05-03），后续放回时
// 改回 import 即可。
import { ExamplesTab, FidelityCard, ProjectCard, TypePicker } from '@/features/home';
import { LogoIcon, PlusIcon } from '@/features/home/icons';
import { ApiKeyModal } from '@/features/settings/ApiKeyModal';
import { PROVIDER_LABELS } from '@open-design/contracts';
import { byokKey } from '@/lib/byok-key';
import { getModelPref } from '@/lib/model-pref';

// ───────── Layout ─────────

const Page = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: ${(p) => p.theme.colors.bg100};
  color: ${(p) => p.theme.colors.fg100};
  font-family: ${(p) => p.theme.fonts.sans};
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid ${(p) => p.theme.colors.line100};
  background: ${(p) => p.theme.colors.bg100};
  gap: 16px;
`;

const Brand = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
`;

const BrandText = styled.div`
  white-space: nowrap;
`;

const BrandTitle = styled.div`
  font-family: ${(p) => p.theme.fonts.serif};
  font-size: 19px;
  line-height: 1;
  letter-spacing: -0.2px;
`;

const BrandSub = styled.div`
  font-size: 10px;
  color: ${(p) => p.theme.colors.fg400};
  margin-top: 2px;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const ResearchBadge = styled.span`
  font-size: 10px;
  color: ${(p) => p.theme.colors.fg400};
  font-family: ${(p) => p.theme.fonts.mono};
  letter-spacing: 0.5px;
  padding: 2px 7px;
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 999px;
  white-space: nowrap;
`;

// API key entry — pinned to the bottom of the left rail so it's always
// in reach without the user having to click into a project first. Replaces
// the previous header pill + gear icon. Color flips brand-orange when the
// active provider has no key, to pull the eye on first load.
const RailApiKeyButton = styled.button<{ $missing: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 12px;
  background: ${(p) => (p.$missing ? p.theme.colors.brandTint : 'transparent')};
  border: 1px solid ${(p) => (p.$missing ? p.theme.colors.brandBase : p.theme.colors.line200)};
  border-radius: 8px;
  color: ${(p) => (p.$missing ? p.theme.colors.brandPress : p.theme.colors.fg400)};
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  white-space: nowrap;

  &:hover {
    background: ${(p) => (p.$missing ? p.theme.colors.brandSoft : p.theme.colors.bg200)};
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const RailApiKeyDot = styled.span<{ $set: boolean }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => (p.$set ? '#1a8a40' : '#c8c4bc')};
  flex-shrink: 0;
`;

const RailApiKeyMain = styled.span`
  font-weight: 500;
`;

const RailApiKeySub = styled.span`
  color: ${(p) => p.theme.colors.fg300};
`;

// Wrapper to space the language pill below the API-key pill while letting the
// inner LanguageMenu (`variant="rail"`) own its own full-width button styling.
const RailLanguageSlot = styled.div`
  margin-top: 8px;
`;

const Spacer = styled.div`
  flex: 1;
`;

const TopTabs = styled.div`
  display: flex;
  gap: 22px;
  flex-shrink: 0;
`;

const TopTab = styled.button<{ $active: boolean; $disabled: boolean }>`
  padding: 8px 0;
  white-space: nowrap;
  background: transparent;
  border: none;
  border-bottom: 2px solid ${(p) => (p.$active ? p.theme.colors.fg100 : 'transparent')};
  margin-bottom: -1px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  color: ${(p) =>
    p.$disabled ? p.theme.colors.fg500 : p.$active ? p.theme.colors.fg100 : p.theme.colors.fg300};
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  transition:
    color 0.14s,
    border-color 0.14s;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
`;

const Rail = styled.aside`
  width: 280px;
  border-right: 1px solid ${(p) => p.theme.colors.line100};
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  background: ${(p) => p.theme.colors.bg100};
`;

const RailHeading = styled.div`
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
`;

const Label = styled.label`
  font-size: 11.5px;
  color: ${(p) => p.theme.colors.fg400};
  margin-bottom: 4px;
  display: block;
`;

const NameInput = styled.input`
  padding: 8px 10px;
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 6px;
  font-size: 12.5px;
  margin-bottom: 14px;
  background: ${(p) => p.theme.colors.bg50};
  color: ${(p) => p.theme.colors.fg100};
  font-family: inherit;
  outline: none;
  width: 100%;

  &:focus {
    border-color: ${(p) => p.theme.colors.brandBase};
  }

  &::placeholder {
    color: ${(p) => p.theme.colors.fg400};
  }
`;

const FidelityRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
`;

const CreateButton = styled.button`
  width: 100%;
  justify-content: center;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  background: ${(p) => p.theme.colors.brandBase};
  color: #fff;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.14s;

  &:hover:not(:disabled) {
    background: ${(p) => p.theme.colors.brandHover};
  }

  &:active:not(:disabled) {
    background: ${(p) => p.theme.colors.brandPress};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

const Hint = styled.div`
  font-size: 10.5px;
  color: ${(p) => p.theme.colors.fg400};
  text-align: center;
  margin-top: 14px;
  line-height: 1.5;
`;

// 隐藏 file input —— 由 ImportLink 文字按钮触发
const ImportInput = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
`;

const ImportLink = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
  padding: 8px 12px;
  background: transparent;
  border: 1px dashed ${(p) => p.theme.colors.line200};
  border-radius: 8px;
  font-family: inherit;
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg300};
  cursor: pointer;
  transition:
    background 0.14s,
    color 0.14s,
    border-color 0.14s;

  &:hover:not(:disabled) {
    background: ${(p) => p.theme.colors.bg200};
    color: ${(p) => p.theme.colors.fg100};
    border-color: ${(p) => p.theme.colors.line100};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }

  svg {
    width: 12px;
    height: 12px;
  }
`;

const Main = styled.main`
  flex: 1;
  padding: 20px 28px;
  overflow: auto;
  background: ${(p) => p.theme.colors.bg100};
`;

const SubBar = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 18px;
`;

const SubTabsBox = styled.div`
  display: flex;
  padding: 4px;
  background: ${(p) => p.theme.colors.bg200};
  border-radius: 8px;
  gap: 2px;
`;

const SubTab = styled.button<{ $active: boolean }>`
  padding: 5px 14px;
  font-size: 12px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  background: ${(p) => (p.$active ? p.theme.colors.bg50 : 'transparent')};
  color: ${(p) => (p.$active ? p.theme.colors.fg100 : p.theme.colors.fg300)};
  font-weight: ${(p) => (p.$active ? 600 : 400)};
  box-shadow: ${(p) => (p.$active ? p.theme.shadows.sm : 'none')};
  font-family: inherit;
  transition: background 0.14s;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 18px;
`;

const Empty = styled.div`
  grid-column: 1 / -1;
  padding: 60px;
  text-align: center;
  color: ${(p) => p.theme.colors.fg400};
  font-size: 13px;
`;

const ErrorBanner = styled.div`
  margin-bottom: 16px;
  padding: 10px 14px;
  border: 1px solid ${(p) => p.theme.colors.danger};
  background: #fbeae5;
  border-radius: 8px;
  color: ${(p) => p.theme.colors.danger};
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const ErrorMessage = styled.div`
  flex: 1;
  min-width: 0;
`;

const RetryButton = styled.button`
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  background: ${(p) => p.theme.colors.danger};
  color: #fff;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition:
    opacity 0.14s,
    background 0.14s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.danger};
    outline-offset: 2px;
  }
`;

const Caret = styled.span`
  display: inline-block;
  animation: blink 1s steps(1) infinite;
  @keyframes blink {
    50% {
      opacity: 0.2;
    }
  }
`;

// ───────── Component ─────────

type TopTabKey = 'Designs' | 'Examples' | 'Design systems';
type SubTabKey = 'Recent' | 'Your designs';

// Tab keys remain stable English literals (used for routing logic / a11y
// state); the human-visible label resolves through i18n inside render.
const TOP_TABS: { key: TopTabKey; enabled: boolean; labelKey: TopTabLabelKey }[] = [
  { key: 'Designs', enabled: true, labelKey: 'home.topTab.designs' },
  { key: 'Examples', enabled: true, labelKey: 'home.topTab.examples' },
  { key: 'Design systems', enabled: false, labelKey: 'home.topTab.designSystems' },
];

type TopTabLabelKey = 'home.topTab.designs' | 'home.topTab.examples' | 'home.topTab.designSystems';

const SUB_TABS: { key: SubTabKey; labelKey: 'home.subTab.recent' | 'home.subTab.yours' }[] = [
  { key: 'Recent', labelKey: 'home.subTab.recent' },
  { key: 'Your designs', labelKey: 'home.subTab.yours' },
];

export function Home() {
  const t = useT();
  const navigate = useNavigate();

  // 表单
  const [type, setType] = useState<ProjectType>('prototype');
  const [name, setName] = useState('');
  // 用户决定 (2026-05-03): 创建项目暂时不让选设计系统，默认 'none'，让 agent
  // 自由发挥；设计系统选择入口以后再做。Picker UI 从表单移除（保留组件以便后
  // 续放回）。
  const [systemId, setSystemId] = useState('none');
  // setSystemId 暂时未在 UI 暴露 —— ESLint will warn no-unused-vars otherwise
  void setSystemId;
  const [fidelity, setFidelity] = useState<Fidelity>('high');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  // 视图状态
  const [topTab, setTopTab] = useState<TopTabKey>('Designs');
  const [subTab, setSubTab] = useState<SubTabKey>('Recent');

  // BYOK key presence — re-checked on each render so the badge state
  // updates after the user saves a key in the modal. Cheap (one
  // localStorage.getItem) so re-rendering on every parent update is fine.
  // Bumped via `byokTick` after the modal saves so the state actually
  // re-flows (byokKey.isSet() is a side-effect read, React doesn't know
  // when localStorage mutates).
  const [byokTick, setByokTick] = useState(0);
  void byokTick; // referenced to keep the dep
  const byokSet = byokKey.isSet(getModelPref().provider);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 项目列表
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setListError(null);
    try {
      const res = await api<ListProjectsResponse>('/api/projects');
      setProjects(res.projects ?? []);
    } catch (err) {
      // API 还没写完时不阻塞 UI；显示软失败
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setListError(msg);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleRenameProject = useCallback(
    async (project: Project, nextName: string) => {
      // Optimistic: update UI then PATCH; revert on error.
      const prev = projects;
      setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, name: nextName } : p)));
      try {
        await api<Project>(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: 'PATCH',
          body: { name: nextName } as unknown as BodyInit,
        });
      } catch (err) {
        setProjects(prev);
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        setListError(msg);
      }
    },
    [projects],
  );

  const handleDeleteProject = useCallback(
    async (project: Project) => {
      const prev = projects;
      setProjects((list) => list.filter((p) => p.id !== project.id));
      try {
        await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      } catch (err) {
        setProjects(prev);
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        setListError(msg);
      }
    },
    [projects],
  );

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      // 'open-design-default' 是隐式默认（不存 D1，agent 自由发挥但用我们的暖色调
      // tokens）；'none' 是用户**显式**选无 design system —— 显式传 'none' 给后端，
      // 让 chat agent 的 system prompt 能区分两者并给出"自由发挥 / 不引外部 CDN"
      // 的指令。其它 id（如 future ds-uuid）原样传出。
      const designSystemId = systemId === 'open-design-default' ? undefined : systemId;
      const body: CreateProjectRequest = {
        name: trimmed,
        type,
        fidelity,
        ...(designSystemId ? { designSystemId } : {}),
      };
      const project = await api<Project>('/api/projects', {
        method: 'POST',
        body: body as unknown as BodyInit,
      });
      // 乐观插入到列表 + NEW 徽章
      setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      setJustCreatedId(project.id);
      setName('');
      // 略停一会儿让 NEW 徽章被看到，然后跳转
      window.setTimeout(() => {
        setJustCreatedId(null);
        navigate(`/p/${project.id}`);
      }, 700);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }, [creating, fidelity, name, navigate, systemId, type]);

  // ── 一键导入 zip ──
  // 入口在 Create 按钮下方。点击触发 hidden file input 选 .zip → 解压 → POST
  // 项目 → 串行 PUT 文件 → 跳转到新项目。详细策略 (路径过滤 / 体积上限 /
  // 二进制跳过) 见 lib/zip-import.ts。
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const handleImportFile = useCallback(
    async (file: File) => {
      if (importing) return;
      setImporting(true);
      setImportStatus(null);
      setCreateError(null);
      try {
        const result = await importProjectFromZip(file, {
          onProgress: ({ total, done, current }) => {
            setImportStatus(
              done < total
                ? current
                  ? t('home.importProgressWith', { done, total, current })
                  : t('home.importProgress', { done, total })
                : null,
            );
          },
        });
        // 加进列表 + NEW 徽章
        setProjects((prev) => [result.project, ...prev.filter((p) => p.id !== result.project.id)]);
        setJustCreatedId(result.project.id);
        if (result.filesSkipped.length > 0) {
          showToast({
            variant: 'info',
            message: t('home.importToastSkipped', {
              uploaded: result.filesUploaded,
              skipped: result.filesSkipped.length,
            }),
          });
        } else {
          showToast({
            variant: 'info',
            message: t('home.importToastOk', {
              uploaded: result.filesUploaded,
              name: result.project.name,
            }),
          });
        }
        window.setTimeout(() => {
          setJustCreatedId(null);
          navigate(`/p/${result.project.id}`);
        }, 700);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('home.importFailed');
        setCreateError(msg);
        showToast({ variant: 'error', message: msg });
      } finally {
        setImporting(false);
        setImportStatus(null);
        // reset input value so选同一个 zip 也能再次触发 onChange
        if (importInputRef.current) importInputRef.current.value = '';
      }
    },
    [importing, navigate, t],
  );

  const filtered = useMemo(() => {
    return projects.filter((p) => (subTab === 'Recent' ? true : p.type !== 'design_system'));
  }, [projects, subTab]);

  return (
    <Page>
      <Header>
        <Brand>
          <LogoIcon size={22} />
          <BrandText>
            <BrandTitle>{t('app.brand')}</BrandTitle>
            <BrandSub as="a" href="https://www.imsai.cc/" target="_blank" rel="noopener noreferrer">
              {t('app.brandSub')}
            </BrandSub>
          </BrandText>
          <ResearchBadge>{t('app.brandPill')}</ResearchBadge>
        </Brand>
        <Spacer />
        <TopTabs role="tablist">
          {TOP_TABS.map((tab) => (
            <TopTab
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={topTab === tab.key}
              aria-disabled={!tab.enabled}
              $active={topTab === tab.key && tab.enabled}
              $disabled={!tab.enabled}
              disabled={!tab.enabled}
              title={tab.enabled ? undefined : t('common.comingSoon')}
              onClick={() => tab.enabled && setTopTab(tab.key)}
            >
              {t(tab.labelKey)}
            </TopTab>
          ))}
        </TopTabs>
        <Spacer />
      </Header>

      <ApiKeyModal
        open={settingsOpen}
        onSaved={() => {
          setSettingsOpen(false);
          setByokTick((t) => t + 1);
        }}
        onCancel={() => setSettingsOpen(false)}
      />

      <Body>
        <Rail>
          <TypePicker value={type} onChange={setType} />

          <RailHeading>
            {type === 'prototype'
              ? t('home.newPrototype')
              : t('home.newGeneric', { type: type.replace('_', ' ') })}
          </RailHeading>

          <Label htmlFor="project-name">{t('home.projectNameLabel')}</Label>
          <NameInput
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            placeholder={t('home.projectNamePlaceholder')}
          />

          {/* 用户决定 (2026-05-03): 设计系统选择入口暂时不展示，默认 'none' 让
              agent 自由发挥；后续再放回 <DesignSystemPicker />。 */}

          <FidelityRow>
            <FidelityCard
              label={t('home.fidelityWireframe')}
              kind="wire"
              fidelity="wireframe"
              active={fidelity === 'wireframe'}
              onSelect={setFidelity}
            />
            <FidelityCard
              label={t('home.fidelityHigh')}
              kind="hifi"
              fidelity="high"
              active={fidelity === 'high'}
              onSelect={setFidelity}
            />
          </FidelityRow>

          <CreateButton
            type="button"
            disabled={!name.trim() || creating}
            onClick={() => void handleCreate()}
            data-testid="project-create-cta"
          >
            {creating ? (
              <>
                <Caret>●</Caret>
                {t('home.creating')}
              </>
            ) : (
              <>
                <PlusIcon />
                {t('home.create')}
              </>
            )}
          </CreateButton>

          {createError && (
            <ErrorBanner role="alert" style={{ marginTop: 10, marginBottom: 0 }}>
              <ErrorMessage>{createError}</ErrorMessage>
            </ErrorBanner>
          )}

          {/* Import zip 入口：接受 zip-export 产物 + 兼容布局的第三方 export。
              隐 file input + 文字按钮触发选文件。*/}
          <ImportInput
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
            }}
            data-testid="home-import-zip-input"
            aria-label={t('home.importZipAria')}
          />
          <ImportLink
            type="button"
            disabled={importing || creating}
            onClick={() => importInputRef.current?.click()}
            data-testid="home-import-zip-button"
          >
            {importing ? <Caret>●</Caret> : <PlusIcon />}
            {importing ? (importStatus ?? t('home.importing')) : t('home.importZip')}
          </ImportLink>

          <Hint>{t('home.privacyHint')}</Hint>

          <Spacer />

          {/* Two top-level rail entries pinned to the bottom — API keys (the
              critical setup) on top, Language (preference) below. Both are
              first-class so users don't have to dive into a settings modal
              for either. The previous Workspace header gear icon has been
              removed; settings live only here. */}
          <RailApiKeyButton
            type="button"
            $missing={!byokSet}
            onClick={() => setSettingsOpen(true)}
            data-testid="home-api-key-button"
            title={
              byokSet
                ? t('home.apiKeyTipSet', { provider: PROVIDER_LABELS[getModelPref().provider] })
                : t('home.apiKeyTipUnset', { provider: PROVIDER_LABELS[getModelPref().provider] })
            }
          >
            <RailApiKeyDot $set={byokSet} aria-hidden="true" />
            <RailApiKeyMain>{t('home.apiKeysLabel')}</RailApiKeyMain>
            <RailApiKeySub>
              {byokSet ? PROVIDER_LABELS[getModelPref().provider] : t('home.apiKeysSet')}
            </RailApiKeySub>
          </RailApiKeyButton>
          <RailLanguageSlot>
            <LanguageMenu variant="rail" />
          </RailLanguageSlot>
        </Rail>

        <Main>
          {topTab === 'Designs' ? (
            <>
              <SubBar>
                <SubTabsBox role="tablist">
                  {SUB_TABS.map((tab) => (
                    <SubTab
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={subTab === tab.key}
                      $active={subTab === tab.key}
                      onClick={() => setSubTab(tab.key)}
                    >
                      {t(tab.labelKey)}
                    </SubTab>
                  ))}
                </SubTabsBox>
                <Spacer />
              </SubBar>

              {listError && (
                <ErrorBanner role="alert">
                  <ErrorMessage>{t('home.errorLoad', { msg: listError })}</ErrorMessage>
                  <RetryButton
                    type="button"
                    data-testid="project-list-retry"
                    disabled={loadingProjects}
                    onClick={() => void loadProjects()}
                  >
                    {loadingProjects ? t('common.retrying') : t('common.retry')}
                  </RetryButton>
                </ErrorBanner>
              )}

              <Grid data-testid="project-list">
                {loadingProjects ? (
                  <Empty data-testid="project-list-loading">{t('home.loadingProjects')}</Empty>
                ) : filtered.length === 0 ? (
                  // listError 时跳过 empty placeholder 避免误导（GET 5xx ≠
                  // 真的没数据；ErrorBanner + RetryButton 已表达错误状态）。
                  // 但有缓存的项目时仍要渲染——比如 DELETE 5xx revert 后，
                  // listError 已设但 projects 列表没空。
                  listError ? null : (
                    <Empty data-testid="project-list-empty">{t('home.emptyNoProjects')}</Empty>
                  )
                ) : (
                  filtered.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      justCreated={p.id === justCreatedId}
                      highlight={p.type === 'design_system'}
                      color={p.type === 'design_system' ? '#F3E7DF' : '#FAF9F5'}
                      onOpen={() => navigate(`/p/${p.id}`)}
                      onRename={(proj, next) => void handleRenameProject(proj, next)}
                      onDelete={(proj) => void handleDeleteProject(proj)}
                    />
                  ))
                )}
              </Grid>
            </>
          ) : topTab === 'Examples' ? (
            <ExamplesTab onProjectCreated={(p) => setProjects((prev) => [p, ...prev])} />
          ) : (
            <Empty>{t('home.comingSoonEmpty', { tab: topTab })}</Empty>
          )}
        </Main>
      </Body>
    </Page>
  );
}

export default Home;
