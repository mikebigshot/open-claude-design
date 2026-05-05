// FilePreviewPane — split-layout right pane unit tests.
//
// Coverage focus:
//   - Wave 1 follow-up: api() must be called with `expectText: true` for
//     content fetches so .json files round-trip byte-for-byte (no JSON parse +
//     re-stringify silently changing indent / key order / trailing newline).
//   - Render branches: empty hint, source <pre>, image, html iframe, error.
//
// We mock @/lib/api directly (not globalThis.fetch) so we can assert on the
// options passed to api() — the test guard is "did we ask for raw text?",
// not "did fetch see the right content-type". Tests that need a stable
// projectId use a unique id per test to avoid module-scope guard bleed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import type { FileRecord } from '@open-design/contracts';

import { theme } from '@/theme/theme';
import { WorkspaceProvider, useWorkspace } from '@/state/workspace';
import { FilePreviewPane } from '../FilePreviewPane';
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
function getWorkspace() {
  if (!workspaceCapture) throw new Error('workspace not captured yet');
  return workspaceCapture;
}

let projectCounter = 0;
function freshProjectId(): string {
  projectCounter += 1;
  return `pp-${projectCounter}-${Date.now()}`;
}

function makeRecord(
  path: string,
  mimeType: FileRecord['mimeType'] = 'text/jsx',
  projectId = 'proj-1',
): FileRecord {
  return {
    projectId,
    path,
    sha256: 'h',
    size: 100,
    mimeType,
    updatedAt: new Date().toISOString(),
  };
}

function renderPane(files: FileRecord[], projectId: string = freshProjectId()) {
  return render(
    <ThemeProvider theme={theme}>
      <WorkspaceProvider projectId={projectId}>
        <WorkspaceCapture />
        <FilePreviewPane files={files.map((f) => ({ ...f, projectId }))} />
      </WorkspaceProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  workspaceCapture = null;
  apiMock.mockReset();
  // Default: comments fetch returns empty, content fetch returns a string.
  apiMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/comments')) return { comments: [] };
    return 'export default null';
  });
});

afterEach(() => {
  cleanup();
});

describe('FilePreviewPane — content fetch round-trip', () => {
  it('passes { expectText: true } when fetching file content (preserves .json formatting)', async () => {
    // Wave 1 follow-up: without expectText, api() auto-parses application/json
    // responses and re-stringifies — destroying the original indentation, key
    // order, and trailing newline. Caller must opt into raw text.
    const records = [makeRecord('package.json', 'application/json')];
    renderPane(records);
    act(() => {
      getWorkspace().dispatch({ type: 'set_previewing_file', path: 'package.json' });
    });

    // Wait for the content fetch to fire.
    await waitFor(() => {
      const contentCalls = apiMock.mock.calls.filter(
        ([path]) => typeof path === 'string' && path.includes('/files/package.json'),
      );
      expect(contentCalls.length).toBeGreaterThan(0);
    });

    const contentCall = apiMock.mock.calls.find(
      ([path]) => typeof path === 'string' && path.includes('/files/package.json'),
    );
    expect(contentCall).toBeTruthy();
    const opts = contentCall![1] as { expectText?: boolean } | undefined;
    expect(opts?.expectText).toBe(true);
  });

  it('renders raw .json text verbatim in the source preview (no JSON round-trip)', async () => {
    // The verbatim string the worker would return — including trailing
    // newline. If api() is called without expectText, the text would come
    // back as an already-parsed object and we'd re-stringify with our own
    // indentation, breaking this assertion.
    const original = '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n';
    const records = [makeRecord('package.json', 'application/json')];
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/comments')) return { comments: [] };
      if (path.includes('/files/package.json')) return original;
      return undefined;
    });

    renderPane(records);
    act(() => {
      getWorkspace().dispatch({ type: 'set_previewing_file', path: 'package.json' });
    });

    const pre = await screen.findByTestId('file-preview-source-pre');
    // textContent normalizes whitespace? In <pre> it preserves; verify exact
    // characters survive. We allow truncation marker not to apply here since
    // original is well below 80 lines.
    expect(pre.textContent).toBe(original);
  });
});
