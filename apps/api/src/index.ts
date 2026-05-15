// Worker entry —— 路由挂载 + CORS + /health。
//
// agent loop 在浏览器（用 Vercel AI SDK）；worker 不参与 chat path，仅做文件存储。

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { assetsRoute } from './routes/assets.js';
import { chatsRoute } from './routes/chats.js';
import { commentsRoute } from './routes/comments.js';
import { filesCopyRoute } from './routes/files-copy.js';
import { filesEditRoute } from './routes/files-edit.js';
import { filesGrepRoute } from './routes/files-grep.js';
import { filesRoute } from './routes/files.js';
import { messagesRoute } from './routes/messages.js';
import { projectsRoute } from './routes/projects.js';
import { shareRoute } from './routes/share.js';
import { templatesRoute } from './routes/templates.js';
import { utilFetchRoute } from './routes/util-fetch.js';

export type Env = {
  DB: D1Database;
  BLOBS: R2Bucket;
  // Comma-separated origin allowlist, e.g. "http://localhost:5173,https://your-pages.pages.dev".
  // Defaults to localhost dev origin when unset (see wrangler.toml [vars]).
  ALLOWED_ORIGINS?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (origin && allowed.includes(origin) ? origin : null),
    credentials: true,
  })(c, next);
});

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'open-design-api',
    slice: 'agent-sdk-switch',
    time: new Date().toISOString(),
  }),
);

// 业务路由（无 chat 流式端点；agent 在浏览器；messages / comments / chats 仅做持久化）。
app.route('/api/projects', projectsRoute);
app.route('/api/projects', filesRoute);
app.route('/api/projects', filesCopyRoute);
app.route('/api/projects', filesEditRoute);
app.route('/api/projects', filesGrepRoute);
app.route('/api/projects', chatsRoute);
app.route('/api/projects', messagesRoute);
app.route('/api/projects', commentsRoute);
app.route('/api/projects', assetsRoute);
app.route('/api', shareRoute);
app.route('/api', templatesRoute);
app.route('/api/util', utilFetchRoute);

app.onError((err, c) => {
  console.error('API error:', err);
  const message = err instanceof Error ? err.message : 'internal error';
  return c.json({ code: 'internal_error', message }, 500);
});

export default app;
