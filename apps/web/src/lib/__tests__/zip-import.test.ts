import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeCommonDirPrefix, importProjectFromZip } from '../zip-import';

// 单测重点：核心算法（公共前缀剥离 + 路径过滤 + 二进制跳过）+ API call 顺序
// （POST /projects → PUT /files * N）+ 错误传播。完整 round-trip 留给 e2e。

describe('computeCommonDirPrefix', () => {
  it('returns "" for empty', () => {
    expect(computeCommonDirPrefix([])).toBe('');
  });
  it('strips dir for single file', () => {
    expect(computeCommonDirPrefix(['my-app/App.jsx'])).toBe('my-app/');
    expect(computeCommonDirPrefix(['App.jsx'])).toBe('');
  });
  it('finds shared prefix and snaps to dir boundary', () => {
    expect(computeCommonDirPrefix(['my-app/App.jsx', 'my-app/Btn.jsx'])).toBe('my-app/');
    expect(computeCommonDirPrefix(['my-app/src/A.jsx', 'my-app/src/B.jsx'])).toBe('my-app/src/');
  });
  it('returns "" when files do not share a dir prefix', () => {
    expect(computeCommonDirPrefix(['App.jsx', 'src/Btn.jsx'])).toBe('');
  });
  it('does not split inside a filename', () => {
    // 'my-app' / 'my-archive' 都以 'my-' 开头但不是公共目录前缀
    expect(computeCommonDirPrefix(['my-app/A.jsx', 'my-archive/B.jsx'])).toBe('');
  });
});

// ── importProjectFromZip integration with mocked api/fetch ──

const apiSpy = vi.fn<
  (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>
>();

vi.mock('../api', async () => {
  return {
    api: (path: string, init?: { method?: string; body?: unknown }) => apiSpy(path, init),
    ApiError: class ApiError extends Error {},
  };
});

beforeEach(() => {
  apiSpy.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function buildZipFile(entries: Record<string, string>, name = 'demo.zip'): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  return zip
    .generateAsync({ type: 'blob' })
    .then((blob) => new File([blob], name, { type: 'application/zip' }));
}

describe('importProjectFromZip', () => {
  it('rejects non-zip files', async () => {
    const file = new File(['hi'], 'foo.txt', { type: 'text/plain' });
    await expect(importProjectFromZip(file)).rejects.toThrow(/Only \.zip/);
  });

  it('creates project, strips common dir prefix, uploads only text files', async () => {
    const zip = await buildZipFile({
      'my-app/App.jsx': '<App/>',
      'my-app/src/Btn.jsx': '<Btn/>',
      'my-app/logo.png': '\x89PNG\r\n\x1a\n', // 二进制 magic — 应跳过
      'my-app/__MACOSX/whatever': 'junk', // 这种路径不会被生成（zip.file 不区分）
      'my-app/.DS_Store': 'junk',
    });

    apiSpy.mockImplementation(async (path, init) => {
      if (path === '/api/projects' && init?.method === 'POST') {
        return {
          id: 'p-new',
          name: 'demo',
          type: 'prototype',
          fidelity: 'high',
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T00:00:00Z',
        };
      }
      if (path.includes('/files/') && init?.method === 'PUT') {
        return { path: '', sha256: 'abc', size: 0, version: 1 };
      }
      return undefined;
    });

    const result = await importProjectFromZip(zip);
    expect(result.project.id).toBe('p-new');
    expect(result.filesUploaded).toBe(2); // App.jsx + src/Btn.jsx
    expect(result.filesSkipped.map((s) => s.path)).toContain('logo.png');

    // PUT urls 应是剥掉 my-app/ 前缀后的路径
    const putCalls = apiSpy.mock.calls.filter(
      ([, init]) => (init as { method?: string })?.method === 'PUT',
    );
    expect(putCalls.length).toBe(2);
    const urls = putCalls.map(([url]) => url as string);
    expect(urls.some((u) => u.endsWith('/files/App.jsx'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/files/src/Btn.jsx'))).toBe(true);
  });

  it('throws if zip is empty', async () => {
    const zip = await buildZipFile({});
    await expect(importProjectFromZip(zip)).rejects.toThrow(/empty/);
  });

  it('uses opts.name when provided', async () => {
    const zip = await buildZipFile({ 'A.jsx': '<A/>' });
    apiSpy.mockImplementation(async (path, init) => {
      if (path === '/api/projects' && init?.method === 'POST') {
        return {
          id: 'p-named',
          name: 'My Custom Name',
          type: 'prototype',
          fidelity: 'high',
          createdAt: 'x',
          updatedAt: 'x',
        };
      }
      return { path: '', sha256: '', size: 0, version: 1 };
    });

    await importProjectFromZip(zip, { name: 'My Custom Name' });
    const postCall = apiSpy.mock.calls.find(
      ([, init]) => (init as { method?: string })?.method === 'POST',
    );
    expect(postCall).toBeDefined();
    const body = (postCall![1] as { body: unknown }).body as { name: string };
    expect(body.name).toBe('My Custom Name');
  });

  it('reports progress through callback', async () => {
    const zip = await buildZipFile({
      'A.jsx': '<A/>',
      'B.jsx': '<B/>',
      'C.jsx': '<C/>',
    });
    apiSpy.mockImplementation(async (path, init) => {
      if (path === '/api/projects' && init?.method === 'POST') {
        return { id: 'p', name: 'demo', type: 'prototype', fidelity: 'high', createdAt: 'x', updatedAt: 'x' };
      }
      return { path: '', sha256: '', size: 0, version: 1 };
    });

    const progress: { total: number; done: number }[] = [];
    await importProjectFromZip(zip, {
      onProgress: ({ total, done }) => {
        progress.push({ total, done });
      },
    });
    // 至少应有起 / done 各阶段的事件，最后 done === total
    expect(progress.length).toBeGreaterThanOrEqual(2);
    const last = progress[progress.length - 1]!;
    expect(last.done).toBe(last.total);
    expect(last.total).toBe(3);
  });

});
