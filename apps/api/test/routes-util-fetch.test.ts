import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import { makeTestApp } from './helpers/test-app.js';

// Real route shape (apps/api/src/routes/util-fetch.ts):
//   GET /api/util/fetch?url=<absolute-url>
//   - 400 missing_url / invalid_url / protocol_not_allowed / private_ip_blocked
//   - 200 { ok, title, text } on success (text-ish content only)
//
// SSRF defenses we exercise here:
//   - reject non-http(s) protocols
//   - reject private / loopback / link-local hostnames
//   - reject malformed URLs

describe('routes/util-fetch', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  it('returns 400 missing_url when no url query', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/util/fetch');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_url');
  });

  it('returns 400 invalid_url for malformed URLs', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/util/fetch?url=not-a-url');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_url');
  });

  it('returns 400 protocol_not_allowed for non-http(s) schemes', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/util/fetch?url=' + encodeURIComponent('ftp://example.com'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('protocol_not_allowed');
  });

  it('blocks SSRF: 127.0.0.1 (loopback)', async () => {
    const app = makeTestApp();
    const res = await app.request(
      '/api/util/fetch?url=' + encodeURIComponent('http://127.0.0.1/secret'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('private_ip_blocked');
  });

  it('blocks SSRF: 10.0.0.0/8 (private)', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/util/fetch?url=' + encodeURIComponent('http://10.0.0.5/'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('private_ip_blocked');
  });

  it('blocks SSRF: 192.168.x.x (private)', async () => {
    const app = makeTestApp();
    const res = await app.request(
      '/api/util/fetch?url=' + encodeURIComponent('http://192.168.1.1/'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('private_ip_blocked');
  });

  it('blocks SSRF: 169.254.x.x (link-local — AWS / GCP metadata)', async () => {
    const app = makeTestApp();
    const res = await app.request(
      '/api/util/fetch?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('private_ip_blocked');
  });

  it('blocks SSRF: ::1 (IPv6 loopback)', async () => {
    const app = makeTestApp();
    const res = await app.request('/api/util/fetch?url=' + encodeURIComponent('http://[::1]/'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('private_ip_blocked');
  });
});
