// /api/projects   —— project CRUD:
//   GET    /api/projects        ← ListProjects
//   POST   /api/projects        ← CreateProject
//   GET    /api/projects/:id    ← GetProject
//   PATCH  /api/projects/:id    ← UpdateProject
//   DELETE /api/projects/:id    ← DeleteProject
//
// 字段命名 camelCase（TypeScript 风格），JSON wire format。

import type {
  CreateProjectRequest,
  ListProjectsResponse,
  Project,
  UpdateProjectRequest,
} from '@open-design/contracts';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from '../storage/d1.js';

export const projectsRoute = new Hono<{ Bindings: Env }>();

/** GET /api/projects?limit=20&offset=0 */
projectsRoute.get('/', async (c) => {
  const limit = clampInt(c.req.query('limit'), 1, 100, 20);
  const offset = clampInt(c.req.query('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
  const projects = await listProjects(c.env.DB, limit, offset);
  return c.json({ projects } satisfies ListProjectsResponse);
});

/** POST /api/projects */
projectsRoute.post('/', async (c) => {
  const body = await c.req.json<CreateProjectRequest>();
  if (!body.name || !body.type || !body.fidelity) {
    return c.json({ code: 'invalid_request', message: 'name, type, fidelity are required' }, 400);
  }
  const project = await createProject(c.env.DB, body);
  return c.json(project satisfies Project, 201);
});

/** GET /api/projects/:id */
projectsRoute.get('/:id', async (c) => {
  const project = await getProject(c.env.DB, c.req.param('id'));
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  return c.json(project satisfies Project);
});

/** PATCH /api/projects/:id */
projectsRoute.patch('/:id', async (c) => {
  const body = await c.req.json<UpdateProjectRequest>();
  const id = c.req.param('id');
  const project = await updateProject(c.env.DB, id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
  });
  if (!project) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  return c.json(project satisfies Project);
});

/** DELETE /api/projects/:id */
projectsRoute.delete('/:id', async (c) => {
  const ok = await deleteProject(c.env.DB, c.req.param('id'));
  if (!ok) {
    return c.json({ code: 'not_found', message: 'project not found' }, 404);
  }
  return c.body(null, 204);
});

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
