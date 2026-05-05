// /api/projects/:id/comments   ← Comment 工具持久化
//   GET    /api/projects/:id/comments              ← ListComments
//   POST   /api/projects/:id/comments              ← CreateComment（client gen id，idempotent）
//   DELETE /api/projects/:id/comments/:commentId   ← DeleteComment
//
// 设计理由（详见 CLAUDE.md §「post-MVP 持久化」）：
//   - id 由客户端生成（crypto.randomUUID），optimistic UI 时 client/server id 一致
//   - 不引 conversations 层；project → 多 comments 直接挂
//   - INSERT 用 ON CONFLICT REPLACE，retry 幂等

import type {
  Comment,
  CreateCommentRequest,
  CreateCommentResponse,
  ListCommentsResponse,
} from '@open-design/contracts';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import {
  deleteComment,
  getProject,
  insertComment,
  listComments,
  touchProject,
} from '../storage/d1.js';

export const commentsRoute = new Hono<{ Bindings: Env }>();

/** GET /api/projects/:id/comments —— 列项目所有 pins。 */
commentsRoute.get('/:id/comments', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  const comments = await listComments(c.env.DB, projectId);
  return c.json({ comments } satisfies ListCommentsResponse);
});

/** POST /api/projects/:id/comments —— 创建 pin（client 提供 id）。 */
commentsRoute.post('/:id/comments', async (c) => {
  const projectId = c.req.param('id');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }

  const body = await c.req.json<CreateCommentRequest>();
  if (typeof body.id !== 'string' || !body.id) {
    return c.json({ code: 'invalid_request', message: 'id must be a non-empty string' }, 400);
  }
  if (typeof body.n !== 'number' || !Number.isFinite(body.n)) {
    return c.json({ code: 'invalid_request', message: 'n must be a finite number' }, 400);
  }
  if (typeof body.x !== 'number' || typeof body.y !== 'number') {
    return c.json({ code: 'invalid_request', message: 'x and y must be numbers' }, 400);
  }
  if (typeof body.text !== 'string') {
    return c.json({ code: 'invalid_request', message: 'text must be a string' }, 400);
  }

  const comment: Comment = await insertComment(c.env.DB, projectId, {
    id: body.id,
    n: body.n,
    x: body.x,
    y: body.y,
    text: body.text,
    selector: body.selector,
    filePath: body.filePath,
  });
  await touchProject(c.env.DB, projectId);

  return c.json({ comment } satisfies CreateCommentResponse, 201);
});

/** DELETE /api/projects/:id/comments/:commentId —— 按 id 删。 */
commentsRoute.delete('/:id/comments/:commentId', async (c) => {
  const projectId = c.req.param('id');
  const commentId = c.req.param('commentId');
  const project = await getProject(c.env.DB, projectId);
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  const ok = await deleteComment(c.env.DB, projectId, commentId);
  if (!ok) {
    return c.json({ code: 'not_found', message: 'comment not found' }, 404);
  }
  await touchProject(c.env.DB, projectId);
  return c.body(null, 204);
});
