// /api/projects/:id/messages   ← chat history persistence
//   GET  /api/projects/:id/messages?chatId=...   ← ListMessages（拉某 chat 的 thread）
//   PUT  /api/projects/:id/messages              ← ReplaceMessages（onFinish 时整 thread 替换）
//                                                    body 必填 chatId
//
// Task 2 后必填 chatId（每条 chat 自己的 thread）。整 thread replace 比单条
// upsert 简单：客户端 useChat 的 onFinish 已是 round-trip 完成节点，thread 短、
// payload 可控；D1 batch 内 implicit transaction 保证原子性。
//
// data 列存 Vercel AI SDK 的 UIMessage 整体 JSON；server 不 parse parts，
// 只抽 id / role 当索引列。详见 storage/d1.ts replaceMessages()。

import type {
  ListMessagesResponse,
  PutMessagesRequest,
  PutMessagesResponse,
} from '@open-design/contracts';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import {
  getChat,
  getProject,
  listMessages,
  replaceMessages,
  touchChat,
  touchProject,
  type PersistedMessageInput,
} from '../storage/d1.js';

export const messagesRoute = new Hono<{ Bindings: Env }>();

/** GET /api/projects/:id/messages?chatId=... —— 列某 chat 的聊天历史。 */
messagesRoute.get('/:id/messages', async (c) => {
  const projectId = c.req.param('id');
  const chatId = c.req.query('chatId');
  if (!chatId) {
    return c.json({ code: 'invalid_request', message: 'chatId query param is required' }, 400);
  }
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  const chat = await getChat(c.env.DB, projectId, chatId);
  if (!chat) {
    return c.json({ code: 'not_found', message: 'chat not found' }, 404);
  }
  const messages = await listMessages(c.env.DB, projectId, chatId);
  return c.json({ messages } satisfies ListMessagesResponse);
});

/** PUT /api/projects/:id/messages —— 整 thread 替换（按 chatId 范围）。 */
messagesRoute.put('/:id/messages', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }

  const body = await c.req.json<PutMessagesRequest>();
  if (!body.chatId || typeof body.chatId !== 'string') {
    return c.json({ code: 'invalid_request', message: 'chatId is required' }, 400);
  }
  if (!Array.isArray(body.messages)) {
    return c.json({ code: 'invalid_request', message: 'messages must be an array' }, 400);
  }
  const chat = await getChat(c.env.DB, projectId, body.chatId);
  if (!chat) {
    return c.json({ code: 'not_found', message: 'chat not found' }, 404);
  }

  const inputs: PersistedMessageInput[] = [];
  for (const raw of body.messages) {
    if (!raw || typeof raw !== 'object') {
      return c.json({ code: 'invalid_request', message: 'message must be an object' }, 400);
    }
    const m = raw as { id?: unknown; role?: unknown };
    if (typeof m.id !== 'string' || !m.id) {
      return c.json(
        { code: 'invalid_request', message: 'message.id must be a non-empty string' },
        400,
      );
    }
    if (typeof m.role !== 'string' || !m.role) {
      return c.json(
        { code: 'invalid_request', message: 'message.role must be a non-empty string' },
        400,
      );
    }
    inputs.push({ id: m.id, role: m.role, data: raw });
  }

  const count = await replaceMessages(c.env.DB, projectId, body.chatId, inputs);
  await touchChat(c.env.DB, projectId, body.chatId);
  await touchProject(c.env.DB, projectId);

  return c.json({ count } satisfies PutMessagesResponse);
});
