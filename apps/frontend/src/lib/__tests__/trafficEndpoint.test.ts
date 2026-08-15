import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/traffic';

type JsonBody = Record<string, unknown>;

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

function successfulAggregate(urlValue: string) {
  const url = new URL(urlValue);
  const since = Number(url.searchParams.get('since'));
  const until = Number(url.searchParams.get('until')) + 1;
  const hourMs = 60 * 60 * 1000;
  const rows = Array.from({ length: (until - since) / hourMs }, (_, index) => ({
    timestamp: new Date(since + index * hourMs).toISOString(),
    pageviews: 1,
    visitors: 1,
  }));
  return {
    ok: true,
    json: async () => ({
      version: 1,
      query: {
        since: new Date(since).toISOString(),
        until: new Date(until).toISOString(),
      },
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
  vi.stubEnv('TRAFFIC_EXCLUDED_ACCOUNT_IDS', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('public traffic totals', () => {
  it('returns exact page views for the last 24 hours, 7 days, and 30 days', async () => {
    const fetchSpy = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(successfulAggregate(String(input))),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const { body, headers, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toEqual({
      pageViews24h: 24,
      pageViews7d: 168,
      pageViews30d: 720,
      fetchedAt: '2026-08-14T20:00:00.000Z',
      windowEndedAt: '2026-08-14T20:00:00.000Z',
      countingStartedAt: '2026-08-03T00:00:00.000Z',
      teamExclusionConfigured: false,
    });
    expect(headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    for (const call of fetchSpy.mock.calls) {
      const [input, init] = call;
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        'https://api.vercel.com/v1/query/web-analytics/visits/aggregate',
      );
      expect(url.searchParams.get('projectId')).toBe('prj_test');
      expect(url.searchParams.get('teamId')).toBe('team_test');
      expect(url.searchParams.get('by')).toBe('hour');
      expect(url.searchParams.get('limit')).toBe('100');
      expect(
        (Number(url.searchParams.get('until')) + 1 - Number(url.searchParams.get('since'))) /
          (60 * 60 * 1000),
      ).toBeLessThanOrEqual(168);
      expect(init).toMatchObject({
        headers: { Authorization: 'Bearer private-test-token', Accept: 'application/json' },
      });
    }
  });

  it('keeps a real zero distinct from unavailable data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const response = successfulAggregate(String(input));
        return Promise.resolve({
          ...response,
          json: async () => ({ ...(await response.json()), data: [] }),
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
    });
  });

  it.each([
    ['Vercel cannot be reached', () => Promise.reject(new Error('offline'))],
    [
      'Vercel omits a number',
      (input: string | URL | Request) => {
        const response = successfulAggregate(String(input));
        return Promise.resolve({
          ...response,
          json: async () => {
            const payload = await response.json();
            return { ...payload, data: [{ timestamp: payload.data[0].timestamp }] };
          },
        });
      },
    ],
    [
      'Vercel reports a materially different range',
      (input: string | URL | Request) => {
        const response = successfulAggregate(String(input));
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
