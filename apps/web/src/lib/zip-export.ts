// 把项目所有源文件 + 一个 standalone HTML 打包成 zip 下载。
//
// 布局：所有源文件按 path 直放 zip 根，附加一个 "<Project Name> Prototype.html"
// 包装文件。HTML 内引用旁边相对路径的 jsx 文件 + CDN React/Babel/SRI integrity
// → 解压后双击 HTML 浏览器立即跑。
//
// 用 jszip 在浏览器侧组装；不走后端，省一次 round-trip 和 worker zip 复杂度。

import JSZip from 'jszip';

import type { FileMimeType, FileRecord, ListFilesResponse } from '@open-design/contracts';
import type { BundleFile } from '@open-design/iframe-runtime/build-srcdoc';

import { api } from './api';
import { buildStandaloneHtml, deriveStandaloneHtmlFilename } from './standalone-html';

/** Mime types whose bytes must not be UTF-8 decoded (would corrupt them). */
const BINARY_MIME_TYPES: ReadonlySet<FileMimeType> = new Set<FileMimeType>([
  'image/png',
  'image/jpeg',
]);

function isBinaryMime(mime: FileMimeType): boolean {
  return BINARY_MIME_TYPES.has(mime);
}

/**
 * 拉所有 file → 装 zip → 加一个 standalone HTML wrapper → 返回 Blob。
 *
 * 内部布局：
 *   - 所有源文件按 path 直放 zip 根（保留 `src/` 等子目录结构）
 *   - 附加一个 "<Project Name> Prototype.html"，引用旁边相对路径的 jsx 文件
 *     + CDN React/Babel/SRI integrity → 用户解压双击 HTML 立即跑
 *
 * P1-9 fix: text files are read as raw text and binary files (image/*) as
 * ArrayBuffer — both bypass api()'s default JSON auto-parse. Without this,
 * `.json` source files round-tripped through JSON.parse + JSON.stringify and
 * lost their original formatting (indentation, key order, trailing newline),
 * and binary files got UTF-8 mangled (e.g. 0x89 PNG magic → 0xEF 0xBF 0xBD).
 */
export async function bundleProjectAsZip(projectId: string, projectName: string): Promise<Blob> {
  const list = await api<ListFilesResponse>(`/api/projects/${encodeURIComponent(projectId)}/files`);
  const zip = new JSZip();

  // 收集 jsx 源用于 buildStandaloneHtml；同时把所有文件原样塞 zip
  const bundleFiles: BundleFile[] = [];

  await Promise.all(
    list.files.map(async (record: FileRecord) => {
      const url = `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURI(record.path)}`;
      if (isBinaryMime(record.mimeType)) {
        const bytes = await api<ArrayBuffer>(url, { expectArrayBuffer: true });
        zip.file(record.path, bytes);
      } else {
        const text = await api<string>(url, { expectText: true });
        zip.file(record.path, text);
        bundleFiles.push({
          path: record.path,
          content: text,
          mimeType: record.mimeType,
        });
      }
    }),
  );

  // 生成 standalone HTML 并加进 zip 根
  if (bundleFiles.some((f) => /\.(jsx|tsx)$/i.test(f.path))) {
    const html = buildStandaloneHtml({
      projectName,
      files: bundleFiles,
    });
    const htmlFilename = deriveStandaloneHtmlFilename(projectName);
    zip.file(htmlFilename, html);
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * 高层包装：bundle + 触发浏览器下载。
 * filename 由 project name 派生（lowercased + 非 alnum → -）。
 */
export async function downloadProjectAsZip(projectId: string, projectName: string): Promise<void> {
  const blob = await bundleProjectAsZip(projectId, projectName);
  const slug =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || projectId;
  const filename = `${slug}.zip`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
