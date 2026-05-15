import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import type { Env } from '../../src/index.js';
import { assetsRoute } from '../../src/routes/assets.js';
import { chatsRoute } from '../../src/routes/chats.js';
import { commentsRoute } from '../../src/routes/comments.js';
import { filesCopyRoute } from '../../src/routes/files-copy.js';
import { filesGrepRoute } from '../../src/routes/files-grep.js';
import { filesRoute } from '../../src/routes/files.js';
import { messagesRoute } from '../../src/routes/messages.js';
import { projectsRoute } from '../../src/routes/projects.js';
import { utilFetchRoute } from '../../src/routes/util-fetch.js';
/**
 * Build a Hono test app with c.env bound to the miniflare test env (DB, BLOBS,
 * secrets), so routes that touch D1/R2 work transparently.
 *
 *   const app = makeTestApp();
 *   const res = await app.request('/api/projects', { ... });
 *
 * The chat route was removed: agent loop now runs browser-side (Vercel AI SDK +
 * BYOK), worker no longer participates in the chat path.
 */
export function makeTestApp(): {
  request: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
} {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/projects', projectsRoute);
  app.route('/api/projects', filesRoute);
  app.route('/api/projects', filesCopyRoute);
  app.route('/api/projects', filesGrepRoute);
  app.route('/api/projects', chatsRoute);
  app.route('/api/projects', messagesRoute);
  app.route('/api/projects', commentsRoute);
  app.route('/api/projects', assetsRoute);
  app.route('/api/util', utilFetchRoute);
  return {
    request: (input, init) =>
      app.request(input as Parameters<typeof app.request>[0], init, env as unknown as Env),
  };
}
