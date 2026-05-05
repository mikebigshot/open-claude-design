import { describe, expect, it } from 'vitest';
import { webFetchTool } from '../web-fetch';
const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

describe('web_fetch', () => {
  it('returns title + text on success', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, title: 'Stripe', text: 'Payments infra...' }), {
        status: 200,
      })) as typeof fetch;
    const r = await webFetchTool().execute!({ url: 'https://stripe.com' }, ctx);
    expect(r).toEqual({ ok: true, title: 'Stripe', text: 'Payments infra...' });
  });
  it('returns error on private IP', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'private_ip_blocked' }), {
        status: 200,
      })) as typeof fetch;
    const r = await webFetchTool().execute!({ url: 'http://10.0.0.1' }, ctx);
    expect(r).toMatchObject({ ok: false, error: 'private_ip_blocked' });
  });
});
