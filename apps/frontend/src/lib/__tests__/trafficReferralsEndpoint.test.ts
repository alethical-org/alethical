import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../../../../api/traffic-referrals';

const HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'www.perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
];
const AUTH = { authorization: 'Bearer admin-test-token' };

function recorder() {
  const headers = new Map<string, string>();
  let status = 0;
  let text = '';
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    status(code: number) {
      status = code;
      return response;
    },
    send(value: string) {
      text = value;
    },
  };
  return { response, read: () => ({ status, headers, text, body: JSON.parse(text) }) };
}

function group(
  host = 'chatgpt.com',
  count: unknown = 12,
  visits: unknown = 10,
  interval: unknown = 2.5,
) {
  return {
    dimensions: { refererHost: host },
    count,
    sum: { visits },
    avg: { sampleInterval: interval },
  };
}

function payload(groups: unknown = [group()]) {
  return { data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: groups }] } } };
}

function source(
  body: unknown = payload(),
  options: { status?: number; text?: string; headers?: Record<string, string> } = {},
) {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/api/v1/admin/access')) return Response.json({ data: { is_admin: true } });
    return new Response(options.text ?? JSON.stringify(body), {
      status: options.status ?? 200,
      headers: options.headers,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function read() {
  const record = recorder();
  await handler({ method: 'GET', headers: AUTH }, record.response);
  return record.read();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T12:30:00Z'));
  vi.stubEnv('CLOUDFLARE_ANALYTICS_API_TOKEN', 'source-private-test-token');
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'source-private-test-account');
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.alethical.com');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('private AI-product referral host counts', () => {
  it('reads fixed 30 complete UTC days and only 7 host groups after the real admin guard', async () => {
    const fetchMock = source();
    const result = await read();
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toBe('Authorization');
    expect(result.body).toMatchObject({
      periodStartedOn: '2026-09-23',
      periodEndedOn: '2026-10-22',
      sampling: 'adaptive-estimates',
      coverage: 'partial-browser-beacon',
      likelyBotsExcluded: true,
      unassignedReferrals: null,
    });
    expect(result.body.providers).toHaveLength(7);
    expect(result.body.providers[0]).toEqual({
      host: 'chatgpt.com',
      status: 'returned',
      estimatedPageViews: 12,
      estimatedExternalEntries: 10,
      averageSampleInterval: 2.5,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
    expect(init.headers.Authorization).toBe('Bearer source-private-test-token');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer admin-test-token');
    const request = JSON.parse(init.body);
    expect(request.variables).toEqual({
      accountTag: 'source-private-test-account',
      start: '2026-09-23T00:00:00.000Z',
      end: '2026-10-23T00:00:00.000Z',
    });
    expect(request.query).toContain('limit: 7');
    expect(request.query).toContain(`refererHost_in: ${JSON.stringify(HOSTS)}`);
    expect(request.query).toContain('dimensions { refererHost }');
    expect(request.query).toContain('requestHost: "www.alethical.com", bot: 0');
    expect(request.query).not.toMatch(/path|userAgent|country|device|clientIP|__schema|__type/i);
    expect(result.text).not.toMatch(/source-private|admin-test|accountTag/);
    expect(result.body.limitations).toContain('not people, sessions or crawler requests');
  });

  it('keeps an empty successful result unknown rather than zero AI visits', async () => {
    source(payload([]));
    const result = await read();
    expect(result.status).toBe(200);
    expect(result.body.providers).toEqual(
      HOSTS.map((host) => ({
        host,
        status: 'no-observations-returned',
        estimatedPageViews: null,
        estimatedExternalEntries: null,
        averageSampleInterval: null,
      })),
    );
    expect(result.body.limitations).toContain('does not establish zero AI visits');
    expect(result.body.unassignedReferrals).toBeNull();
  });

  it('keeps a returned genuine zero distinct from an absent group and interval1 as an estimate', async () => {
    source(payload([group('claude.ai', 0, 0, 1)]));
    const result = await read();
    expect(result.body.providers[4]).toMatchObject({
      status: 'returned',
      estimatedPageViews: 0,
      averageSampleInterval: 1,
    });
    expect(result.body.sampling).toBe('adaptive-estimates');
  });

  it('normalizes DNS host case without widening the host allowlist', async () => {
    source(payload([group('ChatGPT.COM')]));
    expect((await read()).body.providers[0].host).toBe('chatgpt.com');
  });

  it.each([
    'evil.example',
    'chatgpt.com.evil.example',
    'chatgpt.com/private',
    'chatgpt.com:443',
    '',
    ' chatgpt.com',
  ])('rejects unexpected host %s without returning it', async (host) => {
    source(payload([group(host)]));
    const result = await read();
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'Referral data is temporarily unavailable.' });
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('rejects duplicate groups even with different host case', async () => {
    source(payload([group(), group('CHATGPT.COM')]));
    expect((await read()).status).toBe(503);
  });

  it('accepts exactly 7 groups and rejects more than the query cap', async () => {
    source(payload(HOSTS.map((host) => group(host))));
    expect((await read()).status).toBe(200);
    source(payload([...HOSTS.map((host) => group(host)), group()]));
    expect((await read()).status).toBe(503);
  });

  it.each([undefined, null, '12', -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid page-view and entry counts %s',
    async (value) => {
      source(payload([group('chatgpt.com', value)]));
      // An omitted argument invokes the helper default; explicitly remove the field.
      if (value === undefined)
        source(
          payload([
            {
              dimensions: { refererHost: 'chatgpt.com' },
              sum: { visits: 10 },
              avg: { sampleInterval: 1 },
            },
          ]),
        );
      expect((await read()).status).toBe(503);
      const entry = group();
      entry.sum.visits = value;
      source(payload([entry]));
      expect((await read()).status).toBe(503);
    },
  );

  it.each([null, '2', 0, 0.9, -1, NaN, Infinity])(
    'rejects invalid sampling interval %s',
    async (value) => {
      source(payload([group('chatgpt.com', 12, 10, value)]));
      expect((await read()).status).toBe(503);
    },
  );

  it('allows safe integer counts without rounding or estimating actual sample size', async () => {
    source(payload([group('chatgpt.com', Number.MAX_SAFE_INTEGER, 0, 1)]));
    const result = await read();
    expect(result.body.providers[0].estimatedPageViews).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.text).not.toContain('sampleSize');
  });

  it.each([
    null,
    {},
    { data: null },
    { data: { viewer: { accounts: [] } } },
    { data: { viewer: { accounts: [{}, {}] } } },
    payload(null),
    payload({}),
    payload([null]),
  ])('rejects missing or malformed provider data', async (body) => {
    source(body);
    expect((await read()).status).toBe(503);
  });

  it('discards all provider error details and unexpected payload properties', async () => {
    source({ ...payload(), errors: [{ message: 'private path /secret?q=phrase' }] });
    const failed = await read();
    expect(failed.status).toBe(503);
    expect(failed.text).not.toContain('secret');
    source({ ...payload(), extra: 'private path /secret?q=phrase' });
    const success = await read();
    expect(success.status).toBe(200);
    expect(success.text).not.toContain('secret');
  });

  it('rejects oversized content length and streaming bodies without a length', async () => {
    source(payload(), { headers: { 'content-length': '65537' } });
    expect((await read()).status).toBe(503);
    source(payload(), { text: ' '.repeat(65_537) });
    expect((await read()).status).toBe(503);
  });

  it.each([400, 403, 429, 500])('fails closed on provider HTTP%s', async (status) => {
    source(payload(), { status });
    expect((await read()).status).toBe(503);
  });

  it('handles transport failures, malformed JSON and GraphQL error shapes privately', async () => {
    const fetchMock = source();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/admin/access')) return Response.json({ data: { is_admin: true } });
      throw new Error('private source request');
    });
    expect((await read()).body).toEqual({ error: 'Referral data is temporarily unavailable.' });
    source(payload(), { text: 'not JSON: private source detail' });
    expect((await read()).status).toBe(503);
    source({ ...payload(), errors: {} });
    expect((await read()).status).toBe(503);
  });

  it.each(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ANALYTICS_API_TOKEN'])(
    'does not request provider data with missing %s',
    async (key) => {
      vi.stubEnv(key, ' ');
      const fetchMock = source();
      expect((await read()).status).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('requires sign-in without reading provider data', async () => {
    const fetchMock = source();
    const record = recorder();
    await handler({ method: 'GET' }, record.response);
    expect(record.read().status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 503])('retains the real admin access failure %s', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await read()).status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.alethical.com/api/v1/admin/access');
  });

  it('blocks a signed-in non-admin even on a successful access response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { is_admin: false } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await read()).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported methods without any request and keeps the response private', async () => {
    const fetchMock = source();
    const record = recorder();
    await handler({ method: 'POST', headers: AUTH }, record.response);
    expect(record.read().status).toBe(405);
    expect(record.read().headers.get('Cache-Control')).toBe('private, no-store');
    expect(record.read().headers.get('Allow')).toBe('GET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps 30 completed dates across the year boundary', async () => {
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    source();
    expect((await read()).body).toMatchObject({
      periodStartedOn: '2026-12-02',
      periodEndedOn: '2026-12-31',
    });
  });
});
