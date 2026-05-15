// D1 表行类型（TypeScript 描述）。
//
// 不依赖 drizzle-orm（当前走原生 D1 prepared statements）；这个文件只做
// 类型契约 + 列名常量，方便 storage/d1.ts 和 routes/* 共用。
//
// 如果未来引入 drizzle-orm，这个文件可以被 drizzle 的 sqliteTable() 定义直接替换，
// 而 storage/d1.ts 的查询接口保持稳定。
//
// 列名跟 drizzle/migrations/0001_init.sql 严格一致。

import type { Fidelity, ProjectType } from '@open-design/contracts';

// ---------- projects ----------
export interface ProjectRow {
  id: string;
  name: string;
  type: ProjectType;
  fidelity: Fidelity;
  design_system_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- blobs ----------
export interface BlobRow {
  sha256: string;
  mime_type: string;
  size: number;
  created_at: string;
}

// ---------- files ----------
export interface FileRow {
  project_id: string;
  path: string;
  sha256: string;
  version: number;
  created_at: string;
  updated_at: string;
}

// ---------- shares ----------
export interface ShareRow {
  token: string;
  project_id: string;
  created_at: string;
  expires_at: string | null;
}

// ---------- chats ----------
// 一个 project 下 N 条 Chat（多 chat 支持，Task 2）。messages 通过 chat_id
// 关联到 Chat。删 Chat 时它的 messages 走 ON DELETE CASCADE。
//
// PK 是 (project_id, id)，同 messages 表的 PK 风格 —— 每 project 自己的 id
// 空间。title 可空（UI 显示 "New chat"）。
export interface ChatRow {
  id: string;
  project_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- messages ----------
// 一行 = 一条 chat message（Vercel AI SDK UIMessage）。
// data 列存整 UIMessage JSON.stringify，保留 parts / tool calls 等所有结构。
// position 定义同一 chat 内的展示顺序（client 拼好顺序 PUT，server 按 index 写入）。
//
// chat_id 关联 chats(project_id, id) → ON DELETE CASCADE。详见 0006_chats.sql。
//
// PK 是 composite (project_id, id) —— 每个 project 拥有自己的 id 命名空间，
// 同一短 id（如 'm1'）在两个不同 project 下不会撞 UNIQUE 约束。详见
// drizzle/migrations/0005_messages_composite_pk.sql（P2-14）。
export interface MessageRow {
  id: string;
  project_id: string;
  chat_id: string;
  position: number;
  role: string;
  data: string;
  created_at: string;
}

// ---------- assets ----------
// 一行 = 一份注册到 design-system manifest 的资源（register_assets 工具）。
// (project_id, asset, path) 是逻辑唯一键 —— 重新注册同一三元组 = 复用同一行
// 并重置 status 为 needs-review。详见 0007_assets.sql。
export interface AssetRow {
  id: string;
  project_id: string;
  asset: string;
  path: string;
  subtitle: string | null;
  viewport_w: number | null;
  viewport_h: number | null;
  status: 'needs-review' | 'approved' | 'changes-requested';
  group_: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- comments ----------
// 一行 = 一个评论钉子。id 由客户端生成（crypto.randomUUID）以支持 optimistic UI。
// (x, y) 是 viewport 像素坐标；n 是 1-based 显示序号；selector 可选定位元素。
// file_path 可选 —— pin 创建时所属 file 路径，让 CommentsTab 跳回原文件。
export interface CommentRow {
  id: string;
  project_id: string;
  n: number;
  x: number;
  y: number;
  text: string;
  selector: string | null;
  file_path: string | null;
  created_at: string;
}
