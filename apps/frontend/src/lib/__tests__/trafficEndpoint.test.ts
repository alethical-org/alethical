import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/traffic';

type JsonBody = Record<string, unknown>;

const HOUR_MS = 60 * 60 * 1000;
const BILL_FILTER = "startswith(requestPath, '/bills/')";
const LEGISLATOR_FILTER = "startswith(requestPath, '/legislators/')";

function responseRecorder() {
  const headers = new Map<string, string>();
  let body = '';
  let status = 0;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
    status(code: number) {
      status = code;
      return response;
    },
    send(value: string) {
      body = value;
    },
  };
  return {
    response,
    read: () => ({
      body: body ? (JSON.parse(body) as JsonBody) : {},
      headers,
      status,
    }),
  };
}

function requestedRange(url: URL) {
  const since = Number(url.searchParams.get('since'));
  const until = Number(url.searchParams.get('until')) + 1;
  return { hours: (until - since) / HOUR_MS, since, until };
}

function successfulVercelResponse(urlValue: string) {
  const url = new URL(urlValue);
  const { hours, since, until } = requestedRange(url);
  const filter = url.searchParams.get('filter') ?? undefined;
  const query = {
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
    ...(filter ? { filter } : {}),
  };

  if (url.pathname.endsWith('/visits/count')) {
    let pageviews = hours * 10;
    if (filter === "requestPath eq '/'") pageviews = hours;
    if (filter === "requestPath eq '/bills' or startswith(requestPath, '/bills/')") {
      pageviews = hours * 4;
    }
    if (filter === "requestPath eq '/legislators' or startswith(requestPath, '/legislators/')") {
      pageviews = hours * 3;
    }
    return {
      ok: true,
      json: async () => ({
        version: 1,
        query,
        data: { pageviews, visitors: filter ? Math.floor(pageviews / 2) : Math.floor(hours / 2) },
      }),
    };
  }

  if (url.searchParams.get('by') === 'requestPath') {
    const prefix = filter === BILL_FILTER ? '/bills' : '/legislators';
    return {
      ok: true,
      json: async () => ({
        version: 1,
        query: { ...query, groupBy: ['requestPath'], limit: 100 },
        data: [
          { requestPath: `${prefix}/private-profile-one`, pageviews: hours, visitors: 1 },
          { requestPath: `${prefix}/private-profile-two`, pageviews: hours * 2, visitors: 1 },
        ],
      }),
    };
  }

  const rows = Array.from({ length: hours }, (_, index) => ({
    timestamp: new Date(since + index * HOUR_MS).toISOString(),
    pageviews: 10,
    visitors: 1,
  }));
  return {
    ok: true,
    json: async () => ({
      version: 1,
      query: { ...query, groupBy: ['hour'], limit: 100 },
      data: rows,
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-14T20:00:00.000Z'));
  vi.stubEnv('VERCEL_ANALYTICS_ACCESS_TOKEN', 'private-test-token');
  vi.stubEnv('VERCEL_ANALYTICS_PROJECT_ID', 'prj_test');
  vi.stubEnv('VERCEL_ANALYTICS_TEAM_ID', 'team_test');
  vi.stubEnv('TRAFFIC_COUNTING_STARTED_AT', '2026-08-03T00:00:00.000Z');
  vi.stubEnv('TRAFFIC_EXCLUDED_ACCOUNT_IDS', 'team-account-1,team-account-2');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('public traffic totals', () => {
  it('returns backward-compatible page views plus private reach, breadth, and depth totals', async () => {
    const fetchSpy = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(successfulVercelResponse(String(input))),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const { body, headers, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toEqual({
      pageViews24h: 240,
      pageViews7d: 1680,
      pageViews30d: 7200,
      estimatedVisitors24h: 12,
      estimatedVisitors7d: 84,
      estimatedVisitors30d: 360,
      trafficBreakdown7d: {
        sectionPageViews: { home: 168, bills: 672, legislators: 504, other: 336 },
        billProfiles: {
          pageViews: 504,
          differentProfilesViewed: { count: 2, capped: false, cap: 100 },
        },
        legislatorProfiles: {
          pageViews: 504,
          differentProfilesViewed: { count: 2, capped: false, cap: 100 },
        },
      },
      trafficBreakdown30d: {
        sectionPageViews: { home: 720, bills: 2880, legislators: 2160, other: 1440 },
        billProfiles: {
          pageViews: 2160,
          differentProfilesViewed: { count: 2, capped: false, cap: 100 },
        },
        legislatorProfiles: {
          pageViews: 2160,
          differentProfilesViewed: { count: 2, capped: false, cap: 100 },
        },
      },
      fetchedAt: '2026-08-14T20:00:00.000Z',
      windowEndedAt: '2026-08-14T20:00:00.000Z',
      countingStartedAt: '2026-08-03T00:00:00.000Z',
      teamExclusionConfigured: true,
    });
    expect(JSON.stringify(body)).not.toContain('private-profile');
    expect(JSON.stringify(body)).not.toContain('requestPath');
    expect(headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(18);
    for (const call of fetchSpy.mock.calls) {
      const [input, init] = call;
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.vercel.com');
      expect(url.searchParams.get('projectId')).toBe('prj_test');
      expect(url.searchParams.get('teamId')).toBe('team_test');
      expect(Number(url.searchParams.get('until')) + 1).toBeLessThanOrEqual(
        new Date('2026-08-14T20:00:00.000Z').getTime(),
      );
      expect(init).toMatchObject({
        headers: { Authorization: 'Bearer private-test-token', Accept: 'application/json' },
      });
    }
  });

  it('keeps real zeroes distinct from unavailable data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const response = successfulVercelResponse(String(input));
        return Promise.resolve({
          ...response,
          json: async () => {
            const payload = await response.json();
            return {
              ...payload,
              data: Array.isArray(payload.data) ? [] : { pageviews: 0, visitors: 0 },
            };
          },
        });
      }),
    );
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      pageViews24h: 0,
      pageViews7d: 0,
      pageViews30d: 0,
      estimatedVisitors24h: 0,
      estimatedVisitors7d: 0,
      estimatedVisitors30d: 0,
      trafficBreakdown7d: {
        sectionPageViews: { home: 0, bills: 0, legislators: 0, other: 0 },
        billProfiles: {
          pageViews: 0,
          differentProfilesViewed: { count: 0, capped: false, cap: 100 },
        },
      },
    });
  });

  it('marks profile breadth as capped when Vercel groups paths beyond its limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = new URL(String(input));
        const response = successfulVercelResponse(String(input));
        if (url.searchParams.get('by') !== 'requestPath') return Promise.resolve(response);
        const { since, until } = requestedRange(url);
        const filter = url.searchParams.get('filter') ?? '';
        const prefix = filter === BILL_FILTER ? '/bills' : '/legislators';
        return Promise.resolve({
          ...response,
          json: async () => ({
            version: 1,
            query: {
              since: new Date(since).toISOString(),
              until: new Date(until).toISOString(),
              groupBy: ['requestPath'],
              filter,
              limit: 100,
            },
            data: [
              ...Array.from({ length: 100 }, (_, index) => ({
                requestPath: `${prefix}/private-${index}`,
                pageviews: 1,
                visitors: 1,
              })),
              { requestPath: 'Others', pageviews: 23, visitors: 20 },
            ],
          }),
        });
      }),
    );
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      trafficBreakdown7d: {
        billProfiles: {
          pageViews: 123,
          differentProfilesViewed: { count: 100, capped: true, cap: 100 },
        },
      },
      trafficBreakdown30d: {
        legislatorProfiles: {
          pageViews: 123,
          differentProfilesViewed: { count: 100, capped: true, cap: 100 },
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain('private-');
  });

  it.each([
    ['Vercel cannot be reached', () => Promise.reject(new Error('offline'))],
    [
      'an hourly row omits its page-view count',
      (input: string | URL | Request) => {
        const url = new URL(String(input));
        const response = successfulVercelResponse(String(input));
        if (url.searchParams.get('by') !== 'hour') return Promise.resolve(response);
        return Promise.resolve({
          ...response,
          json: async () => {
            const payload = await response.json();
            const rows = payload.data as Array<{ timestamp: string }>;
            return { ...payload, data: [{ timestamp: rows[0]?.timestamp }] };
          },
        });
      },
    ],
    [
      'a visitor total is malformed',
      (input: string | URL | Request) => {
        const url = new URL(String(input));
        const response = successfulVercelResponse(String(input));
        if (!url.pathname.endsWith('/visits/count') || url.searchParams.has('filter')) {
          return Promise.resolve(response);
        }
        return Promise.resolve({
          ...response,
          json: async () => {
            const payload = await response.json();
            return { ...payload, data: { ...payload.data, visitors: 'many' } };
          },
        });
      },
    ],
    [
      'a private path row omits its path',
      (input: string | URL | Request) => {
        const url = new URL(String(input));
        const response = successfulVercelResponse(String(input));
        if (url.searchParams.get('by') !== 'requestPath') return Promise.resolve(response);
        return Promise.resolve({
          ...response,
          json: async () => {
            const payload = await response.json();
            return { ...payload, data: [{ pageviews: 4, visitors: 3 }] };
          },
        });
      },
    ],
    [
      'Vercel reports a materially different range',
      (input: string | URL | Request) => {
        const response = successfulVercelResponse(String(input));
        return Promise.resolve({
          ...response,
          json: async () => {
            const payload = await response.json();
            return {
              ...payload,
              query: {
                ...payload.query,
                until: new Date('2026-08-13T20:00:00.000Z').toISOString(),
              },
            };
          },
        });
      },
    ],
  ])('returns unavailable when %s', async (_label, fetchResult) => {
    vi.stubGlobal('fetch', vi.fn(fetchResult));
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const { body, headers, status } = recorder.read();
    expect(status).toBe(503);
    expect(body).toEqual({ error: 'Traffic data is temporarily unavailable.' });
    expect(headers.get('Cache-Control')).toBe('no-store');
  });
});
