// /api/projects/:id/chats   ← 多 chat 支持（Task 2）。
//
//   GET    /api/projects/:id/chats               ListChats
//   POST   /api/projects/:id/chats               CreateChat
//   PATCH  /api/projects/:id/chats/:chatId       UpdateChat
//   DELETE /api/projects/:id/chats/:chatId       DeleteChat
//
// 一个 project 下 N 条 Chat；每条 Chat 持有自己的 messages timeline（messages
// 表加了 chat_id 外键，FK CASCADE）。详见 packages/contracts/src/chats.ts。
//
// id 由客户端生成（optimistic UI），post body 必填。

import type {
  Chat,
  CreateChatRequest,
  CreateChatResponse,
  ListChatsResponse,
  PatchChatRequest,
  PatchChatResponse,
} from '@open-design/contracts';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import {
  deleteChat,
  getProject,
  insertChat,
  listChats,
  patchChat,
  touchProject,
} from '../storage/d1.js';

export const chatsRoute = new Hono<{ Bindings: Env }>();

/** GET /api/projects/:id/chats —— 列项目下全部 chats。 */
chatsRoute.get('/:id/chats', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  const chats = await listChats(c.env.DB, projectId);
  return c.json({ chats } satisfies ListChatsResponse);
});

/** POST /api/projects/:id/chats —— 新建 chat（id 由客户端生成）。 */
chatsRoute.post('/:id/chats', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  const body = await c.req.json<CreateChatRequest>();
  if (!body.id || typeof body.id !== 'string') {
    return c.json({ code: 'invalid_request', message: 'id is required' }, 400);
  }
  const chat = await insertChat(c.env.DB, projectId, {
    id: body.id,
    title: body.title ?? null,
  });
  await touchProject(c.env.DB, projectId);
  return c.json({ chat } satisfies CreateChatResponse, 201);
});

/** PATCH /api/projects/:id/chats/:chatId —— 改 title。 */
chatsRoute.patch('/:id/chats/:chatId', async (c) => {
  const projectId = c.req.param('id');
  const chatId = c.req.param('chatId');
  const body = await c.req.json<PatchChatRequest>();
  const chat = await patchChat(c.env.DB, projectId, chatId, {
    ...(body.title !== undefined ? { title: body.title } : {}),
  });
  if (!chat) {
    return c.json({ code: 'not_found', message: 'chat not found' }, 404);
  }
  await touchProject(c.env.DB, projectId);
  return c.json({ chat } satisfies PatchChatResponse);
});

/**
 * DELETE /api/projects/:id/chats/:chatId —— hard delete（messages 跟着 cascade）。
 *
 * 调用方需要保证项目至少留 1 条 chat（前端 UI 阻拦最后一条删除）。后端也加保护：
 * 如果 chat 是该 project 唯一一条，返回 409 Conflict。
 */
chatsRoute.delete('/:id/chats/:chatId', async (c) => {
  const projectId = c.req.param('id');
  const chatId = c.req.param('chatId');
  const all = await listChats(c.env.DB, projectId);
  if (all.length <= 1) {
    return c.json(
      {
        code: 'last_chat',
        message: 'cannot delete the last remaining chat',
      },
      409,
    );
  }
  if (!all.some((ch: Chat) => ch.id === chatId)) {
    return c.json({ code: 'not_found', message: 'chat not found' }, 404);
  }
  const ok = await deleteChat(c.env.DB, projectId, chatId);
  if (!ok) {
    return c.json({ code: 'not_found', message: 'chat not found' }, 404);
  }
  await touchProject(c.env.DB, projectId);
  return c.body(null, 204);
});
