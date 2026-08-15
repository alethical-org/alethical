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

function successfulCount(urlValue: string) {
  const url = new URL(urlValue);
  const since = Number(url.searchParams.get('since'));
  const until = Number(url.searchParams.get('until'));
  const days = Math.round((until - since) / (24 * 60 * 60 * 1000));
  const totals =
    days === 1
      ? { pageviews: 168, visitors: 52 }
      : days === 7
        ? { pageviews: 746, visitors: 221 }
        : { pageviews: 2604, visitors: 608 };
  return {
    ok: true,
    json: async () => ({
      version: 1,
      query: {
        since: new Date(since).toISOString(),
        until: new Date(until).toISOString(),
      },
      data: totals,
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
  it('returns only the 4 combined totals and public counting facts', async () => {
    const fetchSpy = vi.fn((input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(successfulCount(String(input))),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const { body, headers, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toEqual({
      visitors24h: 52,
      pageViews24h: 168,
      pageViews7d: 746,
      pageViews30d: 2604,
      fetchedAt: '2026-08-14T20:00:00.000Z',
      countingStartedAt: '2026-08-03T00:00:00.000Z',
      teamExclusionConfigured: false,
    });
    expect(headers.get('Cache-Control')).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const call of fetchSpy.mock.calls) {
      const [input, init] = call;
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe(
        'https://api.vercel.com/v1/query/web-analytics/visits/count',
      );
      expect(url.searchParams.get('projectId')).toBe('prj_test');
      expect(url.searchParams.get('teamId')).toBe('team_test');
      expect(init).toMatchObject({
        headers: { Authorization: 'Bearer private-test-token', Accept: 'application/json' },
      });
    }
  });

  it('keeps a real zero distinct from unavailable data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const response = successfulCount(String(input));
        return Promise.resolve({
          ...response,
          json: async () => ({ ...(await response.json()), data: { pageviews: 0, visitors: 0 } }),
        });
      }),
    );
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      visitors24h: 0,
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
        const response = successfulCount(String(input));
        return Promise.resolve({
          ...response,
          json: async () => ({ ...(await response.json()), data: { visitors: 1 } }),
        });
      },
    ],
    [
      'Vercel reports a materially different range',
      (input: string | URL | Request) => {
        const response = successfulCount(String(input));
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
