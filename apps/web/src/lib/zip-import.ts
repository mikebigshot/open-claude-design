// 一键导入 zip 项目：
// - 接受 zip-export.ts 产出的项目压缩包
// - 兼容平铺布局（源文件按 path 直放 zip 根，无统一前缀）的第三方 export
//
// 流程: JSZip 解压 → 过滤 macOS / 隐藏 / 二进制 → POST /api/projects → 串行
// PUT /api/projects/:id/files/<path> 上传所有文本文件。binary 文件（png/jpeg）
// 暂不支持（PUT /files 只接 {content: string}），收集到 skipped 列表上报 UI。

import JSZip from 'jszip';

import type { CreateProjectRequest, Project } from '@open-design/contracts';

import { api, ApiError } from './api';

// 这些路径 / 文件直接跳过 —— 不算项目内容
function shouldSkipPath(path: string): boolean {
  if (path.startsWith('__MACOSX/')) return true;
  if (path.endsWith('/')) return true; // JSZip 目录条目
  const base = path.split('/').pop() ?? '';
  if (base === '.DS_Store') return true;
  if (base === 'Thumbs.db') return true;
  if (path.startsWith('.git/') || path.includes('/.git/')) return true;
  return false;
}

// 后端 PUT /files 只接 {content: string} —— 二进制（image/*）现阶段无法导入。
// 走文件后缀白名单：进白名单当文本，其余视为二进制跳过。
const TEXT_EXT = new Set([
  'jsx',
  'tsx',
  'js',
  'ts',
  'mjs',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'htm',
  'md',
  'mdx',
  'txt',
  'json',
  'jsonc',
  'svg',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'env',
  'gitignore',
]);

function isTextLikePath(path: string): boolean {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return TEXT_EXT.has(ext);
}

// 限制：单文件 5MB / 单 zip 200 文件 / 总 50MB —— 防止用户拖一个巨大的
// node_modules zip 把 worker 撑爆。
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_COUNT = 200;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export interface ImportProgress {
  total: number;
  done: number;
  /** 当前正在上传的 path（最近一次更新） */
  current?: string;
}

export interface ImportResult {
  project: Project;
  filesUploaded: number;
  /** 因为是二进制 / 超大 / 跳过路径而没上传的文件 + 原因 */
  filesSkipped: { path: string; reason: string }[];
}

export interface ImportOptions {
  /** 默认从 zip 文件名派生（去 .zip 后缀）；调用方可 override */
  name?: string;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}

export async function importProjectFromZip(
  file: File,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  if (!/\.zip$/i.test(file.name)) {
    throw new Error('Only .zip files are supported');
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    throw new Error(`Couldn't read zip: ${msg}`);
  }

  // 收集所有非跳过条目
  const entries: { path: string; entry: JSZip.JSZipObject }[] = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    if (shouldSkipPath(relPath)) return;
    entries.push({ path: relPath, entry });
  });

  if (entries.length === 0) {
    throw new Error('Zip is empty (or contains only system / hidden files)');
  }
  if (entries.length > MAX_FILE_COUNT) {
    throw new Error(`Zip has ${entries.length} files; limit is ${MAX_FILE_COUNT}`);
  }

  // ── 检测公共前缀目录 ──
  // 很多 zip 把所有文件包在一个根目录里（"my-project/App.jsx" 而不是 "App.jsx"）。
  // 找出最长公共前缀（截到最后一个 '/'）剥掉，让导入后的 file tree 跟用户预期
  // 一致（直接 App.jsx，而不是 my-project/App.jsx）。
  const commonPrefix = computeCommonDirPrefix(entries.map((e) => e.path));
  const stripPrefix = (path: string) =>
    commonPrefix && path.startsWith(commonPrefix) ? path.slice(commonPrefix.length) : path;

  // 项目名：opts.name 优先；其次 commonPrefix（去尾 /）；最后 zip 文件名去后缀。
  const inferredFromZip = file.name.replace(/\.zip$/i, '').trim();
  const inferredFromPrefix = commonPrefix ? commonPrefix.replace(/\/$/, '') : '';
  const projectName =
    opts.name?.trim() || inferredFromPrefix || inferredFromZip || 'Imported Project';

  const onProgress = opts.onProgress ?? (() => {});
  onProgress({ total: entries.length, done: 0 });

  // ── 创建项目 ──
  const createBody: CreateProjectRequest = {
    name: projectName,
    type: 'prototype',
    fidelity: 'high',
  };
  let project: Project;
  try {
    project = await api<Project>('/api/projects', {
      method: 'POST',
      body: createBody as unknown as BodyInit,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(`Couldn't create project: ${err.message}`);
    }
    throw err;
  }

  // ── 串行上传所有文本文件 ──
  // 串行（不并行）原因：D1 / R2 worker 端有速率限制；一个个上传也方便给用户
  // 渐进式 progress；失败容易定位。
  const skipped: ImportResult['filesSkipped'] = [];
  let uploaded = 0;
  let totalBytes = 0;

  for (let i = 0; i < entries.length; i++) {
    if (opts.signal?.aborted) {
      throw new Error('Import cancelled');
    }
    const item = entries[i];
    if (!item) continue;
    const path = stripPrefix(item.path);
    if (!path) continue; // prefix 剥完是空（root entry）

    onProgress({ total: entries.length, done: i, current: path });

    // 二进制跳过
    if (!isTextLikePath(path)) {
      skipped.push({ path, reason: 'binary file (image/*) — not supported in import yet' });
      continue;
    }

    // size check：JSZip 没暴露压缩后 size，只能 async 完读完看；用 string
    // 长度近似判断（实际字节大小 ≤ 字符数 * 4，UTF-8 worst case）。
    const text = await item.entry.async('string');
    const approxBytes = text.length * 2; // 中等估计
    if (approxBytes > MAX_FILE_BYTES) {
      skipped.push({
        path,
        reason: `file too large (~${(approxBytes / 1024 / 1024).toFixed(1)}MB > ${MAX_FILE_BYTES / 1024 / 1024}MB)`,
      });
      continue;
    }
    totalBytes += approxBytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `Project exceeds total size limit (${MAX_TOTAL_BYTES / 1024 / 1024}MB). Aborting at file ${i + 1}/${entries.length}.`,
      );
    }

    const url = `/api/projects/${encodeURIComponent(project.id)}/files/${encodeURI(path)}`;
    try {
      await api(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
        signal: opts.signal,
      });
      uploaded++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      skipped.push({ path, reason: `upload failed: ${reason}` });
    }
  }

  onProgress({ total: entries.length, done: entries.length });

  return { project, filesUploaded: uploaded, filesSkipped: skipped };
}

// ── helpers ──

/**
 * 找一组 path 的最长公共目录前缀（包含末尾 '/'），如果有的话。
 * 例：["my-app/App.jsx", "my-app/src/Btn.jsx"] → "my-app/"
 *     ["App.jsx", "src/Btn.jsx"] → ""（公共前缀不在目录边界）
 */
export function computeCommonDirPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const first = paths[0];
  if (first === undefined) return '';
  if (paths.length === 1) {
    const idx = first.lastIndexOf('/');
    return idx >= 0 ? first.slice(0, idx + 1) : '';
  }
  let prefix = first;
  for (let i = 1; i < paths.length; i++) {
    const cur = paths[i];
    if (cur === undefined) continue;
    while (cur.slice(0, prefix.length) !== prefix) {
      prefix = prefix.slice(0, -1);
      if (prefix.length === 0) return '';
    }
  }
  const idx = prefix.lastIndexOf('/');
  return idx >= 0 ? prefix.slice(0, idx + 1) : '';
}
