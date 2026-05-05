import { tool } from 'ai';
import { z } from 'zod';

import { buildUrl } from '@/lib/api.js';

export function listFilesTool(projectId: string) {
  return tool({
    description:
      'List all files in the current project. Returns an array of { path, size, mimeType, updatedAt } records.',
    inputSchema: z.object({}),
    execute: async (_args, { abortSignal }) => {
      const url = buildUrl(`/api/projects/${encodeURIComponent(projectId)}/files`);
      const res = await fetch(url, { method: 'GET', signal: abortSignal });
      // 404 = project 不存在；跟 read_file 一致返回 friendly 让 agent 自己处理
      // （5xx / 401 / 403 仍然 throw，让 agent 走重试 / 拒绝路径）
      if (res.status === 404) {
        return { ok: false, error: 'not_found' };
      }
      if (!res.ok) {
        throw new Error(`list_files failed: ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as {
        files: Array<{ path: string; size: number; mimeType: string; updatedAt: string }>;
      };
      return { ok: true, files: json.files };
    },
  });
}
