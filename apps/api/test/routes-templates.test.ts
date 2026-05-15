import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';
import type { Project } from '@open-design/contracts';

async function createProject(app: ReturnType<typeof makeTestApp>): Promise<string> {
  const res = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'P', type: 'prototype', fidelity: 'wireframe' }),
  });
  return (await res.json<Project>()).id;
}

async function putFile(
  app: ReturnType<typeof makeTestApp>,
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  const res = await app.request(`/api/projects/${projectId}/files/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  expect(res.status).toBe(200);
}

describe('routes/templates', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('save-as-template snapshots all files + GET /templates lists them', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'index.html', '<h1/>');
    await putFile(app, projectId, 'styles.css', 'h1{color:red}');

    const save = await app.request(`/api/projects/${projectId}/save-as-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Landing kit', description: 'q' }),
    });
    expect(save.status).toBe(200);
    const saveBody = (await save.json()) as { templateId: string; fileCount: number };
    expect(saveBody.fileCount).toBe(2);
    expect(saveBody.templateId).toMatch(/^[0-9a-f]{16}$/);

    const list = await app.request('/api/templates');
    const listBody = (await list.json()) as {
      templates: { id: string; name: string; fileCount: number }[];
    };
    const created = listBody.templates.find((t) => t.id === saveBody.templateId);
    expect(created?.name).toBe('Landing kit');
    expect(created?.fileCount).toBe(2);

    const detail = await app.request(`/api/templates/${saveBody.templateId}`);
    const detailBody = (await detail.json()) as {
      template: { files: { path: string; sha256: string }[] };
    };
    expect(detailBody.template.files.map((f) => f.path).sort()).toEqual([
      'index.html',
      'styles.css',
    ]);
  });

  it('rejects empty name', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.txt', 'x');
    const res = await app.request(`/api/projects/${projectId}/save-as-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects when project has no files', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    const res = await app.request(`/api/projects/${projectId}/save-as-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'empty' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /templates/:id returns 404 for unknown id', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/templates/nonexistent');
    expect(res.status).toBe(404);
  });

  it('persists intro_text when provided + surfaces it in list + detail responses', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'index.html', '<h1/>');

    const save = await app.request(`/api/projects/${projectId}/save-as-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Quiz kit',
        description: 'Quiz starter',
        intro_text: 'Tell me what the quiz is about and I will scaffold it.',
      }),
    });
    expect(save.status).toBe(200);
    const saveBody = (await save.json()) as { templateId: string };

    const list = await app.request('/api/templates');
    const listBody = (await list.json()) as {
      templates: { id: string; introText: string | null }[];
    };
    const listed = listBody.templates.find((t) => t.id === saveBody.templateId);
    expect(listed?.introText).toBe(
      'Tell me what the quiz is about and I will scaffold it.',
    );

    const detail = await app.request(`/api/templates/${saveBody.templateId}`);
    const detailBody = (await detail.json()) as { template: { introText: string | null } };
    expect(detailBody.template.introText).toBe(
      'Tell me what the quiz is about and I will scaffold it.',
    );
  });

  it('omits intro_text gracefully (introText is null when not provided)', async () => {
    const app = makeTestApp();
    const projectId = await createProject(app);
    await putFile(app, projectId, 'a.html', '<x/>');

    const save = await app.request(`/api/projects/${projectId}/save-as-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No intro' }),
    });
    const saveBody = (await save.json()) as { templateId: string };

    const detail = await app.request(`/api/templates/${saveBody.templateId}`);
    const detailBody = (await detail.json()) as { template: { introText: string | null } };
    expect(detailBody.template.introText).toBeNull();
  });
});
