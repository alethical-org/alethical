import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import handler from '../../../../../api/traffic-uptime';

// Selected fields from Checkly's public source on 2026-09-07. IDs are fake.
const monitor = (id: string, value: unknown, updated = '2026-09-07T22:40:00Z') => ({
  id,
  activated: true,
  checkType: 'URL',
  frequency: 2,
  created_at: '2026-08-15T14:20:38.213Z',
  status: {
    hasFailures: false,
    hasErrors: false,
    updated_at: updated,
    metrics: {
      '30dSuccessRatio': value,
      // Deliberate decoys: neither the latest pass nor another metric is uptime.
      '1dSuccessRatio': 100,
      '30d': { availability: { currentPeriod: 100, previousPeriod: 90, delta: 10 } },
    },
  },
});
function recorder() {
  let status = 0;
  let body = '';
  const headers = new Map<string, string>();
  const response = {
    setHeader: (k: string, v: string) => {
      headers.set(k, v);
    },
    status: (v: number) => {
      status = v;
      return response;
    },
    send: (v: string) => {
      body = v;
    },
  };
  return { response, result: () => ({ status, body: JSON.parse(body), headers }) };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T22:42:00Z'));
  vi.stubEnv('CHECKLY_API_KEY', '');
  vi.stubEnv('CHECKLY_ACCOUNT_ID', 'account-id');
  vi.stubEnv('CHECKLY_WEB_CHECK_ID', 'web-id');
  vi.stubEnv('CHECKLY_API_READY_CHECK_ID', 'api-id');
  vi.stubEnv('CHECKLY_TRAFFIC_CHECK_ID', '');
  vi.stubEnv(
    'EXPO_PUBLIC_CHECKLY_STATUS_URL',
    'https://alethical-availability.checkly-dashboards.com',
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function source(results: unknown[], options: { metadata?: unknown; pages?: unknown[] } = {}) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/metadata'))
      return {
        ok: true,
        json: async () =>
          options.metadata ?? { id: 1284690, isPrivate: false, accountId: 'account-id' },
      };
    const page = Number(url.searchParams.get('page'));
    return {
      ok: true,
      json: async () =>
        options.pages?.[page - 1] ?? { results, summary: { total: results.length } },
    };
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function read() {
  const r = recorder();
  await handler({ method: 'GET' }, r.response);
  return r.result();
}

it('works without a private key and preserves an independent valid sibling', async () => {
  const fetcher = source([monitor('web-id', 99.98), monitor('api-id', null)]);
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    websiteAvailability30d: 99.98,
    apiAvailability30d: null,
    trafficPageAvailability30d: null,
    measuredAt: { website: '2026-09-07T22:40:00.000Z', api: null },
    monitoringStartedAt: { website: '2026-08-15T14:20:38.213Z', api: null },
    measurementSource: { website: 'status-page', api: null },
  });
  expect(fetcher.mock.calls.every(([url]) => !String(url).includes('/analytics/'))).toBe(true);
});
it('keeps a valid zero percentage without treating the current passing status as uptime', async () => {
  source([monitor('web-id', 0)]);
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.body.websiteAvailability30d).toBe(0);
  expect(result.body.apiAvailability30d).toBeNull();
});
it.each([NaN, Infinity, -1, 101, null, undefined, '100'])(
  'rejects an invalid 30-day percentage %s without using nearby values',
  async (value) => {
    source([monitor('web-id', value)]);
    expect((await read()).status).toBe(503);
  },
);
it.each([
  { ...monitor('web-id', 100), activated: false },
  { ...monitor('web-id', 100), checkType: 'BROWSER' },
  monitor('unknown-id', 100),
  monitor('web-id', 100, '2026-09-07T20:00:00Z'),
  monitor('web-id', 100, '2026-09-08T00:00:00Z'),
  monitor('web-id', 100, 'not-a-date'),
  { ...monitor('web-id', 100), created_at: undefined },
  { ...monitor('web-id', 100), created_at: 'not-a-date' },
  { ...monitor('web-id', 100), created_at: '2026-09-08T00:00:00Z' },
  { ...monitor('web-id', 100), created_at: '2026-09-07T22:41:00Z' },
])('rejects invalid monitor identity, state or measurement dates (%#)', async (row) => {
  source([row]);
  expect((await read()).status).toBe(503);
});
it('withholds a duplicated monitor but retains a valid different monitor', async () => {
  source([
    monitor('web-id', 90),
    monitor('web-id', 100),
    monitor('web-id', 100),
    monitor('api-id', 99),
  ]);
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.body.websiteAvailability30d).toBeNull();
  expect(result.body.apiAvailability30d).toBe(99);
});
it.each([
  { id: 1284690, isPrivate: false, accountId: 'wrong-account' },
  { id: 1284690, isPrivate: true, accountId: 'account-id' },
  { id: '1284690', isPrivate: false, accountId: 'account-id' },
  { id: 0, isPrivate: false, accountId: 'account-id' },
])('refuses a private or mismatched dashboard (%#)', async (metadata) => {
  const fetcher = source([monitor('web-id', 100)], { metadata });
  expect((await read()).status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
  'https://example.com',
  'http://alethical-availability.checkly-dashboards.com',
  'https://user:password@alethical-availability.checkly-dashboards.com',
  'https://alethical-availability.checkly-dashboards.com:8443',
])('never follows an unsafe configured URL (%s)', async (url) => {
  vi.stubEnv('EXPO_PUBLIC_CHECKLY_STATUS_URL', url);
  const fetcher = source([monitor('web-id', 100)]);
  expect((await read()).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});
it('follows bounded pagination to find a monitor on the next page', async () => {
  const first = Array.from({ length: 15 }, (_, i) => monitor('other-' + i, 100));
  const fetcher = source([], {
    pages: [
      { results: first, summary: { total: 16 } },
      { results: [monitor('web-id', 99)], summary: { total: 16 } },
    ],
  });
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.body.websiteAvailability30d).toBe(99);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(String(fetcher.mock.calls[2][0])).toContain('page=2&limit=15');
});
it('withholds a monitor duplicated across provider pages', async () => {
  const first = [
    monitor('web-id', 90),
    ...Array.from({ length: 14 }, (_, i) => monitor('other-' + i, 100)),
  ];
  source([], {
    pages: [
      { results: first, summary: { total: 17 } },
      { results: [monitor('web-id', 100), monitor('api-id', 100)], summary: { total: 17 } },
    ],
  });
  const result = await read();
  expect(result.status).toBe(200);
  expect(result.body.websiteAvailability30d).toBeNull();
  expect(result.body.apiAvailability30d).toBe(100);
});
it.each([
  { results: [monitor('web-id', 100)] },
  { results: [monitor('web-id', 100)], summary: { total: '1' } },
  { results: [monitor('web-id', 100)], summary: { total: -1 } },
  { results: 'not-a-list', summary: { total: 1 } },
])('fails closed on malformed pagination (%#)', async (page) => {
  source([], { pages: [page] });
  expect((await read()).status).toBe(503);
});
it('bounds pagination when the provider advertises too many monitors', async () => {
  const pages = Array.from({ length: 20 }, () => ({
    results: Array.from({ length: 15 }, (_, i) => monitor('other-' + i, 100)),
    summary: { total: 301 },
  }));
  const fetcher = source([], { pages });
  expect((await read()).status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(21);
});
it('treats non-JSON or unsuccessful provider replies as unavailable', async () => {
  for (const response of [
    { ok: false, status: 503 },
    {
      ok: true,
      json: async () => {
        throw new SyntaxError('private detail');
      },
    },
    { ok: true, json: async () => [] },
  ]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect((await read()).status).toBe(503);
  }
});
