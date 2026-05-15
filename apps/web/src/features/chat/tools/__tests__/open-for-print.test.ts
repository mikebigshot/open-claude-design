// open_for_print — opens a project file in a new tab so the user can use the
// OS print dialog to save as PDF. Mirrors v2 official tool name + schema.
//
// We test against a stubbed openWindow factory because real `window.open` is
// flaky in JSDOM (returns null) and we don't want test runs to spam popups.

import { describe, expect, it, vi } from 'vitest';
import { openForPrintTool } from '../open-for-print';

interface ToolInternals {
  // ai-sdk v5/6 expose `inputSchema` + `execute` on the returned descriptor.
  execute: (
    input: { project_relative_file_path: string },
    ctx?: { abortSignal?: AbortSignal },
  ) => Promise<unknown>;
  inputSchema: unknown;
  description?: string;
}

function asTool(t: unknown): ToolInternals {
  return t as ToolInternals;
}

describe('openForPrintTool', () => {
  it('builds a /api/projects/.../files/<path> URL and calls openWindow with it', async () => {
    const openWindow = vi.fn().mockReturnValue({} as Window);
    const t = asTool(openForPrintTool('proj-123', openWindow));
    const out = await t.execute({ project_relative_file_path: 'deck/index.html' });
    expect(openWindow).toHaveBeenCalledTimes(1);
    const calledUrl = openWindow.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/api/projects/proj-123/files/');
    expect(calledUrl).toContain('deck/index.html');
    expect(out).toEqual(
      expect.objectContaining({ ok: true, message: expect.stringMatching(/Cmd\+P|Ctrl\+P/) }),
    );
  });

  it('URI-encodes the project id but does not encode forward slashes in the path', async () => {
    const openWindow = vi.fn().mockReturnValue({} as Window);
    const t = asTool(openForPrintTool('proj with spaces', openWindow));
    await t.execute({ project_relative_file_path: 'sub/dir/file.html' });
    const url = openWindow.mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/projects/proj%20with%20spaces/files/');
    expect(url).toContain('sub/dir/file.html');
    expect(url).not.toContain('sub%2Fdir');
  });

  it('returns popup_blocked when openWindow returns null', async () => {
    const openWindow = vi.fn().mockReturnValue(null);
    const t = asTool(openForPrintTool('proj-1', openWindow));
    const out = await t.execute({ project_relative_file_path: 'index.html' });
    expect(out).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'popup_blocked',
        message: expect.stringMatching(/popup|blocked/i),
      }),
    );
  });

  it('rejects empty path with a helpful error', async () => {
    const openWindow = vi.fn();
    const t = asTool(openForPrintTool('proj-1', openWindow));
    const out = await t.execute({ project_relative_file_path: '' });
    expect(out).toEqual(
      expect.objectContaining({ ok: false, error: 'invalid_path' }),
    );
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('strips leading slash so the URL is well-formed', async () => {
    const openWindow = vi.fn().mockReturnValue({} as Window);
    const t = asTool(openForPrintTool('proj-1', openWindow));
    await t.execute({ project_relative_file_path: '/deck/index.html' });
    const url = openWindow.mock.calls[0]?.[0] as string;
    // No double slash between /files/ and the path.
    expect(url).not.toContain('/files//');
    expect(url).toContain('/files/deck/index.html');
  });

  it('describes itself for the v2 catalog', () => {
    const t = asTool(openForPrintTool('proj-1'));
    expect(t.description).toMatch(/PDF/);
    expect(t.description).toMatch(/new tab|new window|print/i);
  });
});
