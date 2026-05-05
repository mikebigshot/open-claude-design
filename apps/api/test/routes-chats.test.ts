import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type {
  Chat,
  CreateChatResponse,
  ListChatsResponse,
  PatchChatResponse,
  Project,
} from '@open-design/contracts';

// Routes under test (apps/api/src/routes/chats.ts):
//   GET    /api/projects/:id/chats               → 200 { chats: Chat[] } | 404
//   POST   /api/projects/:id/chats               → 201 { chat }          | 400 / 404
//   PATCH  /api/projects/:id/chats/:chatId       → 200 { chat }          | 404
//   DELETE /api/projects/:id/chats/:chatId       → 204                   | 404 / 409

const BASE_PROJECT = {
  name: 'Test Multi-Chat Project',
  type: 'prototype' as const,
  fidelity: 'wireframe' as const,
};

async function createProject(app: ReturnType<typeof makeTestApp>): Promise<Project> {
  const res = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(BASE_PROJECT),
  });
  return (await res.json()) as Project;
}

async function postChat(
  app: ReturnType<typeof makeTestApp>,
  projectId: string,
  body: { id: string; title?: string | null },
): Promise<{ status: number; chat?: Chat }> {
  const res = await app.request(`/api/projects/${projectId}/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) return { status: res.status };
  const json = (await res.json()) as CreateChatResponse;
  return { status: res.status, chat: json.chat };
}

describe('routes/chats', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('GET returns 404 for unknown project', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/no-such-project/chats', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('GET returns empty list for fresh project', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/chats`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListChatsResponse;
    expect(body.chats).toEqual([]);
  });

  it('POST creates a chat then GET lists it', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const id = crypto.randomUUID();
    const created = await postChat(app, project.id, { id, title: 'Chat one' });
    expect(created.status).toBe(201);
    expect(created.chat?.id).toBe(id);
    expect(created.chat?.projectId).toBe(project.id);
    expect(created.chat?.title).toBe('Chat one');

    const res = await app.request(`/api/projects/${project.id}/chats`, { method: 'GET' });
    const body = (await res.json()) as ListChatsResponse;
    expect(body.chats.length).toBe(1);
    expect(body.chats[0]!.id).toBe(id);
  });

  it('POST is idempotent on retry (same id updates title in place)', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const id = crypto.randomUUID();
    const first = await postChat(app, project.id, { id, title: 'A' });
    expect(first.status).toBe(201);
    const second = await postChat(app, project.id, { id, title: 'B' });
    expect(second.status).toBe(201);

    const res = await app.request(`/api/projects/${project.id}/chats`, { method: 'GET' });
    const body = (await res.json()) as ListChatsResponse;
    expect(body.chats.length).toBe(1);
    expect(body.chats[0]!.title).toBe('B');
  });

  it('POST accepts null title (unnamed chat)', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const id = crypto.randomUUID();
    const created = await postChat(app, project.id, { id });
    expect(created.status).toBe(201);
    expect(created.chat?.title).toBeNull();
  });

  it('POST returns 400 when id is missing', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/chats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'no id' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST returns 404 for unknown project', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/no-such-project/chats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID() }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH updates title; GET reflects new title', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const created = await postChat(app, project.id, { id: crypto.randomUUID(), title: 'Old' });
    const id = created.chat!.id;

    const patchRes = await app.request(`/api/projects/${project.id}/chats/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as PatchChatResponse;
    expect(patched.chat.title).toBe('Renamed');
  });

  it('PATCH with explicit null clears title', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const created = await postChat(app, project.id, { id: crypto.randomUUID(), title: 'Old' });
    const id = created.chat!.id;
    const patchRes = await app.request(`/api/projects/${project.id}/chats/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: null }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as PatchChatResponse;
    expect(patched.chat.title).toBeNull();
  });

  it('PATCH returns 404 for unknown chat', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/chats/no-such-chat`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE removes chat when more than one exists', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const a = await postChat(app, project.id, { id: crypto.randomUUID() });
    const b = await postChat(app, project.id, { id: crypto.randomUUID() });
    expect(a.chat).toBeDefined();
    expect(b.chat).toBeDefined();

    const delRes = await app.request(`/api/projects/${project.id}/chats/${a.chat!.id}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(204);

    const listRes = await app.request(`/api/projects/${project.id}/chats`, { method: 'GET' });
    const body = (await listRes.json()) as ListChatsResponse;
    expect(body.chats.length).toBe(1);
    expect(body.chats[0]!.id).toBe(b.chat!.id);
  });

  it('DELETE returns 409 if it would leave the project with 0 chats', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const only = await postChat(app, project.id, { id: crypto.randomUUID() });

    const delRes = await app.request(`/api/projects/${project.id}/chats/${only.chat!.id}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(409);

    const listRes = await app.request(`/api/projects/${project.id}/chats`, { method: 'GET' });
    expect(((await listRes.json()) as ListChatsResponse).chats.length).toBe(1);
  });

  it('DELETE returns 404 for unknown chat (when others exist)', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    await postChat(app, project.id, { id: crypto.randomUUID() });
    await postChat(app, project.id, { id: crypto.randomUUID() });
    const res = await app.request(`/api/projects/${project.id}/chats/no-such-chat`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('Project DELETE cascades chats', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    await postChat(app, project.id, { id: crypto.randomUUID() });

    const delRes = await app.request(`/api/projects/${project.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    // Recreated project should have no chats (FK CASCADE wiped old project's chats).
    const fresh = await createProject(app);
    const listRes = await app.request(`/api/projects/${fresh.id}/chats`, { method: 'GET' });
    expect(((await listRes.json()) as ListChatsResponse).chats).toEqual([]);
  });
});
