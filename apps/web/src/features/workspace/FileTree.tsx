// 文件树（Design Files tab 的内容）—— split layout：左 list + 右 preview pane。
//
// 数据源：fetch GET /api/projects/:id/files；按 file kind 分组；订阅
// state.filesChangedAt tick 让 chat agent 写文件后自动刷新。空项目显示 placeholder。
//
// 行为变化（2026-05-02）：
//   - Click 行 → dispatch set_previewing_file(file.path)（不再直接 navigate）
//   - 右侧 FilePreviewPane 显示 metadata + 内容预览 + Open 按钮
//   - Open 按钮 → dispatch open_file 把它 promote 成 activeTab
//   - 首次进项目仍然 auto-pick entry 到 activeTab（保留首屏体验）；
//     同时把 previewingFile 设为 entry，让 Design Files tab 也有内容可看。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styled from 'styled-components';

import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { useWorkspace } from '@/state/workspace';
import type { FileRecord, ListFilesResponse } from '@open-design/contracts';

import { DESIGN_FILES_TAB, PREVIEW_TAB } from '@/state/types';

import { FilePreviewPane } from './FilePreviewPane';
import { pickEntry, sectionFor, type Section } from './file-utils';
import { FolderIcon, PlusIcon } from './icons';

const Split = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
`;

const Container = styled.div`
  width: 360px;
  flex: 0 0 360px;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 16px 20px 24px 24px;
  font-family: ${({ theme }) => theme.fonts.sans};
  border-right: 1px solid ${({ theme }) => theme.colors.line100};
  background: ${({ theme }) => theme.colors.bg100};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.fg100};
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
`;

const Button = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bg100};
  color: ${({ theme }) => theme.colors.fg300};
  font-size: 13px;
  cursor: not-allowed;
  opacity: 0.5;
`;

const SectionLabel = styled.div`
  margin-top: 16px;
  margin-bottom: 8px;
  color: ${({ theme }) => theme.colors.fg300};
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const Row = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: none;
  background: ${({ theme, $active }) => ($active ? theme.colors.bg200 : 'transparent')};
  width: 100%;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  &:hover {
    background: ${({ theme }) => theme.colors.bg200};
  }
`;

const Icon = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: ${({ $color }) => $color};
  color: white;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
`;

const Name = styled.span`
  flex: 1;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.fg100};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Time = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.fg300};
  margin-left: 8px;
  flex-shrink: 0;
`;

const Placeholder = styled.div`
  margin-top: 64px;
  text-align: center;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.fg300};
  padding: 0 16px;
  line-height: 1.5;
`;

const ErrorText = styled.div`
  margin-top: 24px;
  padding: 12px 16px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
  border-radius: 6px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.fg300};
`;

// PAGES (独立可渲染入口) → COMPONENTS (.jsx) → 其他。
const SECTION_ORDER: Section[] = ['PAGES', 'COMPONENTS', 'SCRIPTS', 'IMAGES', 'SKETCHES', 'OTHER'];

// (autoPickedProjects module-scope Set deprecated 2026-05-03 — replaced by
// state.autoPickDone owned by WorkspaceProvider. The reducer sets it on any
// set_active_tab dispatch, so a user click on Design Files (even pre-fetch)
// flips it true and the effect skips the kick. See state/workspace.tsx.)

interface FileMeta {
  iconColor: string;
  iconText: string;
  type: string;
}

function fileMetaFor(file: FileRecord): FileMeta {
  const m = file.mimeType;
  if (m === 'text/html') return { iconColor: '#C96442', iconText: '<>', type: 'HTML page' };
  if (m === 'text/jsx') return { iconColor: '#5B8DEF', iconText: 'JSX', type: 'React component' };
  if (m === 'text/javascript') return { iconColor: '#F7BD3D', iconText: 'JS', type: 'Script' };
  if (m === 'text/css') return { iconColor: '#39A0A0', iconText: 'CSS', type: 'Stylesheet' };
  if (m === 'image/svg+xml') return { iconColor: '#9C5DE8', iconText: 'SVG', type: 'Image' };
  if (m.startsWith('image/')) return { iconColor: '#9C5DE8', iconText: 'IMG', type: 'Image' };
  return { iconColor: '#7B8CA0', iconText: '?', type: 'File' };
}

type TFn = ReturnType<typeof useT>;

function relativeTime(iso: string, t: TFn): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t('common.justNow');
  if (min < 60) return t('common.minutesAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('common.hoursAgo', { n: hr });
  const d = Math.floor(hr / 24);
  return t('common.daysAgoShort', { n: d });
}

const SECTION_LABEL_KEY = {
  PAGES: 'fileTree.section.pages',
  COMPONENTS: 'fileTree.section.components',
  SCRIPTS: 'fileTree.section.scripts',
  IMAGES: 'fileTree.section.images',
  SKETCHES: 'fileTree.section.sketches',
  OTHER: 'fileTree.section.other',
} as const satisfies Record<Section, Parameters<TFn>[0]>;

export function FileTree() {
  const t = useT();
  const { state, dispatch } = useWorkspace();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!state.projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const list = await api<ListFilesResponse>(
          `/api/projects/${encodeURIComponent(state.projectId)}/files`,
        );
        if (!cancelled) setFiles(list.files);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setFiles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.projectId, state.filesChangedAt]);

  const grouped = useMemo(() => {
    const groups: Record<Section, FileRecord[]> = {
      PAGES: [],
      COMPONENTS: [],
      SCRIPTS: [],
      IMAGES: [],
      SKETCHES: [],
      OTHER: [],
    };
    const sorted = [...files].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    for (const f of sorted) groups[sectionFor(f)].push(f);
    return groups;
  }, [files]);

  // Flat in-DOM order — drives keyboard navigation (ArrowUp/Down/Home/End)
  // and roving tabindex. Must match the render order of <Row> elements
  // inside the SECTION_ORDER loop below.
  const flatPaths = useMemo<string[]>(() => {
    const paths: string[] = [];
    for (const section of SECTION_ORDER) {
      for (const f of grouped[section]) paths.push(f.path);
    }
    return paths;
  }, [grouped]);

  // The treeitem that should hold tabindex=0 (the "tabstop"). WAI-ARIA
  // tree pattern: only one item is in the tab sequence; arrows move focus
  // within the tree without leaving it. We pick the currently selected
  // (previewing) file when present, else the first row, else null.
  const tabstopPath = useMemo<string | null>(() => {
    if (state.previewingFile && flatPaths.includes(state.previewingFile)) {
      return state.previewingFile;
    }
    return flatPaths[0] ?? null;
  }, [flatPaths, state.previewingFile]);

  // Row DOM refs keyed by path so keyboard nav can move focus by name.
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const setRowRef = useCallback((path: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  }, []);

  // Keyboard handler for treeitems — implements the standard WAI-ARIA Tree
  // pattern subset we care about. Folders aren't a real concept yet (flat
  // file list grouped by section header), so Right/Left aren't bound.
  // https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
  const handleRowKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, path: string) => {
      const idx = flatPaths.indexOf(path);
      if (idx === -1) return;

      const focus = (target: number) => {
        const targetPath = flatPaths[target];
        if (!targetPath) return;
        const el = rowRefs.current.get(targetPath);
        el?.focus();
      };

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          if (idx < flatPaths.length - 1) focus(idx + 1);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (idx > 0) focus(idx - 1);
          break;
        }
        case 'Home': {
          e.preventDefault();
          focus(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          focus(flatPaths.length - 1);
          break;
        }
        case 'Enter':
        case ' ': {
          // Activate: set previewingFile (mirrors click). Space included so
          // keyboard users get the same affordance as native <button> + Space.
          e.preventDefault();
          dispatch({ type: 'set_previewing_file', path });
          break;
        }
        default:
          break;
      }
    },
    [dispatch, flatPaths],
  );

  // ───────── auto-pick entry file ─────────
  // First-visit affordance: when files arrive and the user is parked on the
  // Design Files tab, drop them into the canonical entry (App.jsx > index.jsx
  // > index.html > ...) so they don't have to click a row themselves. Also
  // pre-select the entry in the right preview pane regardless — that way when
  // the user comes back to the Design Files tab later, the pane shows
  // something useful instead of an empty hint.
  //
  // 守门用 state.autoPickDone(reducer 在任何 set_active_tab dispatch 时设 true) ——
  // 这样即使 user 在 fetch 完成前 click 任何 tab,reducer 已设 autoPickDone=true,
  // 后续 effect re-run 守门返回。修复了 P0-3 的 race:
  //   1. user goto /p/xxx → activeTab=DESIGN_FILES_TAB(initial), autoPickDone=false
  //   2. FileTree mount,fetch async
  //   3. user click design-files → setActiveTab(DESIGN_FILES_TAB) →
  //      autoPickDone=true(reducer 一律 set,不论值是否变化)
  //   4. fetch resolve → effect 跑 → autoPickDone=true → return ✅
  // 当 user 不点击直接等 fetch 完成,effect 第一次 set autoPickDone=true 也会
  // dispatch set_active_tab(PREVIEW_TAB),reducer 设 autoPickDone=true(同 dispatch)。
  useEffect(() => {
    if (!state.projectId) return;
    if (files.length === 0) return;
    const entry = pickEntry(files.map((f) => f.path));
    if (!entry) return;

    if (state.previewingFile === null) {
      dispatch({ type: 'set_previewing_file', path: entry });
    }

    if (state.autoPickDone) return;
    if (state.activeTab !== DESIGN_FILES_TAB) {
      // User moved away to a non-default tab before fetch completed.
      // Mark autoPickDone so a subsequent fetch re-run doesn't yank them back.
      dispatch({ type: 'mark_auto_pick_done' });
      return;
    }
    // Land on the live iframe preview by default (PREVIEW_TAB), not the entry
    // file path — App.jsx as activeTab would route to FileSourceView under
    // the new dual-view scheme. set_active_tab also sets autoPickDone=true.
    dispatch({ type: 'set_active_tab', tab: PREVIEW_TAB });
  }, [files, state.activeTab, state.autoPickDone, state.projectId, state.previewingFile, dispatch]);

  return (
    <Split data-testid="file-tree">
      <Container>
        <Header>
          <Title id="file-tree-title">{t('fileTree.title')}</Title>
          <Actions>
            <Button disabled>
              <PlusIcon size={12} />
              {t('fileTree.newFile')}
            </Button>
            <Button disabled>
              <FolderIcon size={12} />
              {t('fileTree.newFolder')}
            </Button>
          </Actions>
        </Header>

        {error && (
          <ErrorText data-testid="file-tree-error">{t('fileTree.errorLoad', { error })}</ErrorText>
        )}

        {!error && files.length === 0 && !loading && (
          <Placeholder data-testid="file-tree-empty">
            {t('fileTree.empty')}
            <br />
            {t('fileTree.emptyHint')}
          </Placeholder>
        )}

        {/*
          WAI-ARIA Tree pattern container. role="tree" + roving tabindex
          on children means screen readers announce "tree, X items" and
          keyboard users can ArrowUp/Down between rows after Tab'ing in.
          aria-labelledby points at the visible heading so AT speaks
          "Design files, tree".
        */}
        <div role="tree" aria-labelledby="file-tree-title" data-testid="file-tree-list">
          {SECTION_ORDER.map((section) => {
            const list = grouped[section];
            if (list.length === 0) return null;
            return (
              <div key={section} data-testid={`file-tree-section-${section}`}>
                <SectionLabel>{t(SECTION_LABEL_KEY[section])}</SectionLabel>
                {list.map((file) => {
                  const meta = fileMetaFor(file);
                  const isActive = state.previewingFile === file.path;
                  const isTabstop = tabstopPath === file.path;
                  return (
                    <Row
                      key={file.path}
                      ref={(el) => setRowRef(file.path, el)}
                      $active={isActive}
                      role="treeitem"
                      aria-selected={isActive}
                      // Roving tabindex: exactly one row in the tab order
                      // at a time. Others get -1 so Tab skips them, but
                      // .focus() still works for keyboard nav.
                      tabIndex={isTabstop ? 0 : -1}
                      onClick={() => dispatch({ type: 'set_previewing_file', path: file.path })}
                      onKeyDown={(e) => handleRowKeyDown(e, file.path)}
                      title={file.path}
                      data-testid={`file-tree-item-${file.path}`}
                      data-active={isActive ? 'true' : 'false'}
                    >
                      <Icon $color={meta.iconColor}>{meta.iconText}</Icon>
                      <Name>{file.path}</Name>
                      <Time>{relativeTime(file.updatedAt, t)}</Time>
                    </Row>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Container>

      <FilePreviewPane files={files} />
    </Split>
  );
}
