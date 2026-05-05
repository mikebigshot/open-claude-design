import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type {
  Chat,
  CreateChatResponse,
  ListMessagesResponse,
  Project,
  PutMessagesResponse,
} from '@open-design/contracts';

// Routes under test (apps/api/src/routes/messages.ts):
//   GET  /api/projects/:id/messages?chatId=...   → 200 { messages: UIMessage[] } | 404 / 400
//   PUT  /api/projects/:id/messages              → 200 { count }                 | 400 / 404
//
// Task 2 (multi-chat) update: messages are scoped per chat, chatId is required.

const BASE_PROJECT = {
  name: 'Test Chat Project',
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

async function createChat(
  app: ReturnType<typeof makeTestApp>,
  projectId: string,
  id = crypto.randomUUID(),
  title: string | null = null,
): Promise<Chat> {
  const res = await app.request(`/api/projects/${projectId}/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, title }),
  });
  const body = (await res.json()) as CreateChatResponse;
  return body.chat;
}

// Minimal UIMessage shape (mirrors Vercel AI SDK; we don't import 'ai' here).
function userMsg(id: string, text: string) {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
  };
}
function assistantMsg(id: string, text: string) {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text }],
  };
}

describe('routes/messages', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('GET returns 400 when chatId query is missing', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/messages`, { method: 'GET' });
    expect(res.status).toBe(400);
  });

  it('GET returns 404 for unknown project', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/no-such-project/messages?chatId=any', {
      method: 'GET',
    });
    expect(res.status).toBe(404);
  });

  it('GET returns 404 for unknown chat', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/messages?chatId=no-such-chat`, {
      method: 'GET',
    });
    expect(res.status).toBe(404);
  });

  it('GET returns empty list for fresh chat', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat = await createChat(app, project.id);
    const res = await app.request(`/api/projects/${project.id}/messages?chatId=${chat.id}`, {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListMessagesResponse;
    expect(body.messages).toEqual([]);
  });

  it('PUT then GET round-trips messages preserving order and shape', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat = await createChat(app, project.id);

    const messages = [
      userMsg('m1', 'hello'),
      assistantMsg('m2', 'hi there'),
      userMsg('m3', 'make me a button'),
      {
        id: 'm4',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'sure' },
          {
            type: 'tool-edit_file',
            toolCallId: 'tc-1',
            state: 'output-available',
            input: { path: 'App.jsx', content: '<button/>' },
            output: { ok: true },
          },
        ],
      },
    ];

    const putRes = await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, messages }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as PutMessagesResponse;
    expect(putBody.count).toBe(4);

    const getRes = await app.request(`/api/projects/${project.id}/messages?chatId=${chat.id}`, {
      method: 'GET',
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as ListMessagesResponse;
    expect(getBody.messages).toEqual(messages);
  });

  it('PUT replaces the whole thread (DELETE + INSERT) within a single chat', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat = await createChat(app, project.id);

    // First write
    await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId: chat.id,
        messages: [userMsg('a', 'one'), userMsg('b', 'two')],
      }),
    });

    // Second write replaces — only 'c' should remain
    await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, messages: [userMsg('c', 'three')] }),
    });

    const res = await app.request(`/api/projects/${project.id}/messages?chatId=${chat.id}`, {
      method: 'GET',
    });
    const body = (await res.json()) as ListMessagesResponse;
    expect(body.messages).toEqual([userMsg('c', 'three')]);
  });

  it('PUT for one chat does not touch other chats in the same project', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat1 = await createChat(app, project.id);
    const chat2 = await createChat(app, project.id);

    await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat1.id, messages: [userMsg('a', 'one')] }),
    });
    await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat2.id, messages: [userMsg('b', 'two')] }),
    });

    const res1 = await app.request(`/api/projects/${project.id}/messages?chatId=${chat1.id}`, {
      method: 'GET',
    });
    const res2 = await app.request(`/api/projects/${project.id}/messages?chatId=${chat2.id}`, {
      method: 'GET',
    });
    expect(((await res1.json()) as ListMessagesResponse).messages).toEqual([userMsg('a', 'one')]);
    expect(((await res2.json()) as ListMessagesResponse).messages).toEqual([userMsg('b', 'two')]);
  });

  it('PUT with empty array clears the chat thread', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat = await createChat(app, project.id);

    await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, messages: [userMsg('x', 'temp')] }),
    });

    const clearRes = await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, messages: [] }),
    });
    expect(clearRes.status).toBe(200);
    expect((await clearRes.json()) as PutMessagesResponse).toEqual({ count: 0 });

    const getRes = await app.request(`/api/projects/${project.id}/messages?chatId=${chat.id}`, {
      method: 'GET',
    });
    expect((await getRes.json()) as ListMessagesResponse).toEqual({ messages: [] });
  });

  it('PUT returns 400 when messages is not an array', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat = await createChat(app, project.id);
    const res = await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, messages: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT returns 400 when chatId is missing', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT returns 400 when a message lacks id', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat = await createChat(app, project.id);
    const res = await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, messages: [{ role: 'user', parts: [] }] }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT returns 404 for unknown project', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/projects/no-such-project/messages', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'any', messages: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('PUT returns 404 when chatId does not exist in project', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const res = await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'unknown-chat', messages: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('Project DELETE cascades messages', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat = await createChat(app, project.id);

    await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat.id, messages: [userMsg('m', 'persist me')] }),
    });

    const delRes = await app.request(`/api/projects/${project.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    // Recreate with a different id, then GET should be empty (FK ON DELETE CASCADE
    // wiped chats + messages from the old project).
    const fresh = await createProject(app);
    const freshChat = await createChat(app, fresh.id);
    const res = await app.request(`/api/projects/${fresh.id}/messages?chatId=${freshChat.id}`, {
      method: 'GET',
    });
    expect((await res.json()) as ListMessagesResponse).toEqual({ messages: [] });
  });

  it('DELETE chat cascades its messages', async () => {
    const app = makeTestApp();
    const project = await createProject(app);
    const chat1 = await createChat(app, project.id);
    const chat2 = await createChat(app, project.id);

    await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat1.id, messages: [userMsg('a', 'one')] }),
    });
    await app.request(`/api/projects/${project.id}/messages`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat2.id, messages: [userMsg('b', 'two')] }),
    });

    const delRes = await app.request(`/api/projects/${project.id}/chats/${chat1.id}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(204);

    // chat1 messages should be 404 / cascade-gone; chat2 untouched.
    const chat1Res = await app.request(`/api/projects/${project.id}/messages?chatId=${chat1.id}`, {
      method: 'GET',
    });
    expect(chat1Res.status).toBe(404);
    const chat2Res = await app.request(`/api/projects/${project.id}/messages?chatId=${chat2.id}`, {
      method: 'GET',
    });
    expect(((await chat2Res.json()) as ListMessagesResponse).messages).toEqual([
      userMsg('b', 'two'),
    ]);
  });
});
