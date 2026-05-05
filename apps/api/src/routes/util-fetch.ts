import { Hono } from 'hono';
import type { Env } from '../index.js';

const PRIVATE_IP_RX = /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc00:|fd00:|fe80:)/i;
const MAX_BYTES = 2_000_000; // 2MB
const TIMEOUT_MS = 10_000;

/** URL.hostname returns IPv6 literals with brackets (`[::1]`) — strip them
 *  before matching against PRIVATE_IP_RX so loopback / private v6 ranges
 *  aren't accidentally allowed. */
function normalizeHostname(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

export const utilFetchRoute = new Hono<{ Bindings: Env }>();

utilFetchRoute.get('/fetch', async (c) => {
  const urlParam = c.req.query('url');
  if (!urlParam) return c.json({ error: 'missing_url' }, 400);
  let parsed: URL;
  try {
    parsed = new URL(urlParam);
  } catch {
    return c.json({ error: 'invalid_url' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return c.json({ error: 'protocol_not_allowed' }, 400);
  if (PRIVATE_IP_RX.test(normalizeHostname(parsed.hostname)))
    return c.json({ error: 'private_ip_blocked' }, 400);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return c.json({ ok: false, error: 'fetch_failed', status: res.status });
    const ct = res.headers.get('content-type') ?? '';
    if (!/text|json|xml|html/.test(ct))
      return c.json({ ok: false, error: 'non_text_content', contentType: ct });

    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return c.json({ ok: false, error: 'response_too_large', limitBytes: MAX_BYTES });
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const ch of chunks) {
      buf.set(ch, off);
      off += ch.byteLength;
    }
    const text = new TextDecoder().decode(buf);

    const titleMatch = text.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1]!.trim() : '';

    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 30_000);

    return c.json({ ok: true, title, text: stripped });
  } catch (err) {
    return c.json({ ok: false, error: 'fetch_failed', message: String(err) });
  } finally {
    clearTimeout(t);
  }
});
