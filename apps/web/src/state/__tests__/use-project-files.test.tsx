// useProjectFiles — module-level cache + in-flight dedup for the
// per-project files list + bodies. Verifies the cache is keyed by
// `<projectId>::<changedAt>`, that concurrent calls dedup, that bumping
// `changedAt` invalidates the slot, and that the load error path surfaces.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { _resetProjectFilesCache, useProjectFiles } from '../use-project-files.js';

function mockListAndBodies(files: Array<{ path: string; mimeType: string; body: string }>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/files')) {
      return new Response(
        JSON.stringify({ files: files.map(({ path, mimeType }) => ({ path, mimeType })) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    const f = files.find((x) => url.endsWith(`/${encodeURI(x.path)}`));
    if (!f) return new Response('', { status: 404 });
    return new Response(f.body, { status: 200, headers: { 'content-type': f.mimeType } });
  }) as typeof fetch;
  return { calls };
}

describe('useProjectFiles', () => {
  beforeEach(() => {
    _resetProjectFilesCache();
  });
  afterEach(() => vi.restoreAllMocks());

  it('fetches the project file list + bodies on first mount', async () => {
    mockListAndBodies([
      { path: 'src/x.ts', mimeType: 'text/typescript', body: 'const x = 1;' },
      { path: 'index.html', mimeType: 'text/html', body: '<html>...</html>' },
    ]);
    const { result } = renderHook(() => useProjectFiles('p1', 0));
    await waitFor(() =>
      expect(result.current.files.length).toBe(2),
    );
    expect(result.current.files[0]?.path).toBe('src/x.ts');
    expect(result.current.files[0]?.content).toBe('const x = 1;');
    expect(result.current.loadError).toBeNull();
  });

  it('synchronously serves a cache hit on second mount with same key', async () => {
    mockListAndBodies([{ path: 'a.ts', mimeType: 'text/typescript', body: 'a' }]);
    const first = renderHook(() => useProjectFiles('p1', 0));
    await waitFor(() => expect(first.result.current.files.length).toBe(1));
    // Reset spy count for the second mount.
    const callsBefore = (globalThis.fetch as unknown as { mock?: { calls: unknown[] } });
    void callsBefore;
    const second = renderHook(() => useProjectFiles('p1', 0));
    // Cache hit → files available without waitFor.
    expect(second.result.current.files.length).toBe(1);
  });

  it('dedups concurrent requests (one network call for two simultaneous mounts)', async () => {
    const { calls } = mockListAndBodies([
      { path: 'a.ts', mimeType: 'text/typescript', body: 'a' },
    ]);
    const h1 = renderHook(() => useProjectFiles('p2', 0));
    const h2 = renderHook(() => useProjectFiles('p2', 0));
    await waitFor(() => {
      expect(h1.result.current.files.length).toBe(1);
      expect(h2.result.current.files.length).toBe(1);
    });
    // Exactly one /files list call (followed by one body fetch). Two list
    // calls would mean we didn't dedupe.
    const listCalls = calls.filter((u) => u.endsWith('/files'));
    expect(listCalls).toHaveLength(1);
  });

  it('refetches when changedAt bumps (new cache key)', async () => {
    const { calls } = mockListAndBodies([
      { path: 'a.ts', mimeType: 'text/typescript', body: 'first' },
    ]);
    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => useProjectFiles('p3', tick),
      { initialProps: { tick: 1 } },
    );
    await waitFor(() => expect(result.current.files[0]?.content).toBe('first'));

    // Bump body for next fetch; rerender with a new tick.
    mockListAndBodies([{ path: 'a.ts', mimeType: 'text/typescript', body: 'second' }]);
    rerender({ tick: 2 });
    await waitFor(() => expect(result.current.files[0]?.content).toBe('second'));
    void calls;
  });

  it('surfaces the error on the load-error channel and keeps files empty', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    const { result } = renderHook(() => useProjectFiles('p4', 0));
    await waitFor(() => expect(result.current.loadError).not.toBeNull());
    expect(result.current.files).toEqual([]);
  });

  it('is a no-op when projectId is null', () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const { result } = renderHook(() => useProjectFiles(null, 0));
    expect(result.current.files).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
