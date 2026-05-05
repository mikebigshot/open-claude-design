// FileTree split-layout behavior tests.
//
// Coverage focus: the new "click row → preview pane" flow (vs the old
// "click row → activeTab navigation"). Workspace.tsx routing of activeTab
// is tested separately via Workspace integration tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';
import { WorkspaceProvider, useWorkspace } from '@/state/workspace';
import { DESIGN_FILES_TAB, PREVIEW_TAB } from '@/state/types';
import { FileTree } from '../FileTree';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
  ApiError: class extends Error {},
}));

const apiMock = api as unknown as ReturnType<typeof vi.fn>;

let workspaceCapture: ReturnType<typeof useWorkspace> | null = null;

function WorkspaceCapture() {
  workspaceCapture = useWorkspace();
  return null;
}

// Use a fresh project id per test so the FileTree's module-scope
// `autoPickedProjects` guard doesn't bleed state across tests.
let projectCounter = 0;
function freshProjectId(): string {
  projectCounter += 1;
  return `proj-${projectCounter}-${Date.now()}`;
}

function renderTree(projectId: string = freshProjectId()): void {
  render(
    <ThemeProvider theme={theme}>
      <WorkspaceProvider projectId={projectId}>
        <WorkspaceCapture />
        <FileTree />
      </WorkspaceProvider>
    </ThemeProvider>,
  );
}

function getWorkspace() {
  if (!workspaceCapture) throw new Error('workspace not captured yet');
  return workspaceCapture;
}

const filesPayload = (paths: { path: string; mime: string }[]): unknown => ({
  files: paths.map((p) => ({
    projectId: 'proj-1',
    path: p.path,
    sha256: 'h',
    size: 100,
    mimeType: p.mime,
    updatedAt: new Date().toISOString(),
  })),
});

beforeEach(() => {
  workspaceCapture = null;
  apiMock.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/comments')) return { comments: [] };
    if (path.endsWith('/files')) {
      return filesPayload([
        { path: 'App.jsx', mime: 'text/jsx' },
        { path: 'index.html', mime: 'text/html' },
        { path: 'helpers.js', mime: 'text/javascript' },
      ]);
    }
    if (path.includes('/files/')) {
      // Per-file content fetches from FilePreviewPane.
      return 'export default function App() { return null; }';
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
});

describe('FileTree split layout', () => {
  it('renders a row for each file', async () => {
    renderTree();
    await waitFor(() => {
      // helpers.js only appears in the row list (not in the right pane title
      // until selected) so it's a clean witness for the row rendering.
      expect(screen.getByText('helpers.js')).toBeTruthy();
      expect(screen.getByText('index.html')).toBeTruthy();
    });
  });

  it('clicking a row sets previewingFile (not activeTab)', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));

    // Wait through the auto-pick effect so we're comparing against the
    // settled activeTab (PREVIEW_TAB), not the initial one.
    await waitFor(() => {
      expect(getWorkspace().state.activeTab).toBe(PREVIEW_TAB);
    });
    const beforeActiveTab = getWorkspace().state.activeTab;

    act(() => {
      fireEvent.click(screen.getByText('helpers.js'));
    });

    const ws = getWorkspace();
    expect(ws.state.previewingFile).toBe('helpers.js');
    // activeTab MUST NOT change to the file path — that's the bug the new
    // split layout is here to prevent.
    expect(ws.state.activeTab).toBe(beforeActiveTab);
    expect(ws.state.activeTab).not.toBe('helpers.js');
  });

  it('right pane Open button promotes the file to an open tab + activeTab', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));

    act(() => {
      fireEvent.click(screen.getByText('helpers.js'));
    });

    const openBtn = await screen.findByTestId('file-preview-open-btn');
    act(() => {
      fireEvent.click(openBtn);
    });

    const ws = getWorkspace();
    expect(ws.state.activeTab).toBe('helpers.js');
    expect(ws.state.openTabs).toContain('helpers.js');
  });

  it('auto-pick on first visit lands on PREVIEW_TAB (not the entry path)', async () => {
    renderTree();
    await waitFor(() => {
      const ws = getWorkspace();
      expect(ws.state.activeTab).toBe(PREVIEW_TAB);
    });
  });

  it('auto-pick also pre-selects the entry file in the right preview pane', async () => {
    renderTree();
    await waitFor(() => {
      const ws = getWorkspace();
      expect(ws.state.previewingFile).toBe("index.html");
    });
  });

  it('shows the empty placeholder when project has no files', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      if (path.endsWith('/files')) return { files: [] };
      return undefined;
    });
    renderTree();
    await waitFor(() => {
      expect(screen.getByText(/no files yet/i)).toBeTruthy();
    });
  });

  it('does NOT auto-navigate when user has manually returned to Design Files tab', async () => {
    renderTree();
    // Wait for first auto-pick to finish (sets activeTab to PREVIEW_TAB).
    await waitFor(() => {
      expect(getWorkspace().state.activeTab).toBe(PREVIEW_TAB);
    });
    // User clicks back to "Design Files" — FileTree re-mounts.
    act(() => {
      getWorkspace().dispatch({ type: 'set_active_tab', tab: DESIGN_FILES_TAB });
    });
    // Wait a moment for any re-render / effect cycles.
    await new Promise((r) => setTimeout(r, 50));
    // activeTab should stay on Design Files — module-scope guard prevents
    // a second auto-pick from yanking the user back to PREVIEW_TAB.
    expect(getWorkspace().state.activeTab).toBe(DESIGN_FILES_TAB);
  });
});

// ────────────────────────────────────────────────────────────────────────
// a11y — WAI-ARIA Tree pattern + keyboard navigation
// https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
// ────────────────────────────────────────────────────────────────────────

describe('FileTree — a11y (WAI-ARIA Tree pattern)', () => {
  function getTreeItems(): HTMLElement[] {
    return screen.getAllByRole('treeitem') as HTMLElement[];
  }

  it('exposes role="tree" on the tree container', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));
    const tree = screen.getByRole('tree');
    expect(tree).toBeTruthy();
    // The tree should have an accessible name so AT announces what list it
    // is. Either aria-label (inline) or aria-labelledby (points at heading)
    // is valid per ARIA — both produce a recognisable accname.
    const hasName =
      tree.getAttribute('aria-label') !== null || tree.getAttribute('aria-labelledby') !== null;
    expect(hasName).toBe(true);
  });

  it('exposes role="treeitem" on each row with aria-selected reflecting active state', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));
    // Wait until auto-pick settles. HTML-first 后入口是 index.html (而非 App.jsx)。
    await waitFor(() => {
      expect(getWorkspace().state.previewingFile).toBe('index.html');
    });
    const items = getTreeItems();
    expect(items.length).toBeGreaterThanOrEqual(3);

    const labels = items.map((el) => el.textContent ?? '');
    const indexHtml = items.find((_, i) => labels[i]?.includes('index.html'));
    const helpersJs = items.find((_, i) => labels[i]?.includes('helpers.js'));
    expect(indexHtml?.getAttribute('aria-selected')).toBe('true');
    expect(helpersJs?.getAttribute('aria-selected')).toBe('false');
  });

  it('uses roving tabindex: only the active treeitem has tabindex=0, others -1', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));
    await waitFor(() => {
      expect(getWorkspace().state.previewingFile).toBe('index.html');
    });
    const items = getTreeItems();
    const tabZero = items.filter((el) => el.getAttribute('tabindex') === '0');
    const tabMinusOne = items.filter((el) => el.getAttribute('tabindex') === '-1');
    expect(tabZero.length).toBe(1);
    expect(tabMinusOne.length).toBe(items.length - 1);
    expect(tabZero[0]?.textContent ?? '').toContain('index.html');
  });

  it('ArrowDown moves focus to the next treeitem', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));
    await waitFor(() => {
      expect(getWorkspace().state.previewingFile).toBe("index.html");
    });
    const items = getTreeItems();
    const first = items[0]!;
    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]!);
  });

  it('ArrowUp moves focus to the previous treeitem', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));
    await waitFor(() => {
      expect(getWorkspace().state.previewingFile).toBe("index.html");
    });
    const items = getTreeItems();
    const second = items[1]!;
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]!);
  });

  it('Home moves focus to the first treeitem; End to the last', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));
    await waitFor(() => {
      expect(getWorkspace().state.previewingFile).toBe("index.html");
    });
    const items = getTreeItems();
    const middle = items[1]!;
    middle.focus();

    fireEvent.keyDown(middle, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]!);

    fireEvent.keyDown(items[items.length - 1]!, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]!);
  });

  it('Enter on a focused treeitem selects it (sets previewingFile)', async () => {
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));
    await waitFor(() => {
      expect(getWorkspace().state.previewingFile).toBe("index.html");
    });
    const items = getTreeItems();
    const helpersJs = items.find((el) => (el.textContent ?? '').includes('helpers.js'))!;
    helpersJs.focus();
    fireEvent.keyDown(helpersJs, { key: 'Enter' });

    expect(getWorkspace().state.previewingFile).toBe('helpers.js');
  });

  it('ArrowDown wraps to the last item when on the first (or stops at boundary)', async () => {
    // Either wrap or boundary-stop is acceptable behavior; we just verify
    // it doesn't throw or move focus off-tree.
    renderTree();
    await waitFor(() => screen.getByText('helpers.js'));
    await waitFor(() => {
      expect(getWorkspace().state.previewingFile).toBe("index.html");
    });
    const items = getTreeItems();
    const last = items[items.length - 1]!;
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    // Acceptable: stay on last (no wrap) — the actual contract is "doesn't
    // crash and focus stays inside the tree".
    expect(items).toContain(document.activeElement);
  });
});
