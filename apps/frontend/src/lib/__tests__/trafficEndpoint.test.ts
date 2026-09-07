import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/traffic';

type JsonBody = Record<string, unknown>;

const HOUR_MS = 60 * 60 * 1000;
const PRODUCTION_FILTER = "environment eq 'production'";
const BILL_FILTER = "environment eq 'production' and (startswith(requestPath, '/bills/'))";
const LEGISLATOR_FILTER =
  "environment eq 'production' and (startswith(requestPath, '/legislators/'))";
const HOME_FILTER = "environment eq 'production' and (requestPath eq '/')";
const BILLS_FILTER =
  "environment eq 'production' and (requestPath eq '/bills' or startswith(requestPath, '/bills/'))";
const LEGISLATORS_FILTER =
  "environment eq 'production' and (requestPath eq '/legislators' or startswith(requestPath, '/legislators/'))";
const FIND_MY_LEGISLATOR_FILTER =
  "environment eq 'production' and (requestPath eq '/find-my-legislator')";
const MONEY_FILTER =
  "environment eq 'production' and (requestPath eq '/money' or startswith(requestPath, '/money/'))";
const MONEY_PAGES = {
  money: '/money',
  moneySearch: '/money/search',
  moneyByRace: '/money/races',
  moneyCommitteeList: '/money/committees',
  moneyPayments: '/money/payments',
  moneyOutsideSpending: '/money/outside-spending',
} as const;
const MONEY_PAGES_FILTER =
  PRODUCTION_FILTER +
  ' and (' +
  Object.values(MONEY_PAGES)
    .map((path) => "requestPath eq '" + path + "'")
    .join(' or ') +
  ')';
const COMMITTEE_PROFILE_FILTER =
  "environment eq 'production' and (startswith(requestPath, '/money/committees/'))";
const EMPTY_MONEY_DETAILS = {
  moneySearch: 0,
  moneyByRace: 0,
  moneyCommitteeList: 0,
  moneyPayments: 0,
  moneyOutsideSpending: 0,
  moneyCommitteeProfiles: 0,
  moneyOther: 0,
};
const EMPTY_COMMITTEE_PROFILES = {
  pageViews: 0,
  differentProfilesViewed: { count: 0, capped: false, cap: 100 },
};
const READ_FILTER =
  "environment eq 'production' and (requestPath eq '/read' or startswith(requestPath, '/read/'))";
const LEGACY_ASK_FILTER =
  "environment eq 'production' and (requestPath eq '/ask' or startswith(requestPath, '/ask/'))";

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
  // Serve the same sample for the old unscoped request too, so missing
  // production isolation fails the query assertions rather than fixture lookup.
  const matchesFilter = (expected: string) =>
    filter === expected || `${PRODUCTION_FILTER} and (${filter})` === expected;
  const query = {
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
    ...(filter ? { filter } : {}),
  };

  if (url.searchParams.get('by') === 'environment') {
    const visitors = hours === 24 ? 7 : hours === 7 * 24 ? 19 : 43;
    return {
      ok: true,
      json: async () => ({
        version: 1,
        query: { ...query, groupBy: ['environment'], limit: 1 },
        data: [{ environment: 'production', pageviews: hours * 10, visitors }],
      }),
    };
  }

  if (url.searchParams.get('by') === 'requestPath') {
    const limit = Number(url.searchParams.get('limit'));
    if (limit === 1) {
      let data: Array<{ requestPath: string; pageviews: number; visitors: number }> = [];
      if (matchesFilter(HOME_FILTER)) {
        data = [{ requestPath: '/', pageviews: hours, visitors: 1 }];
      }
      if (matchesFilter(BILLS_FILTER)) {
        data = [
          { requestPath: '/bills', pageviews: hours, visitors: 1 },
          { requestPath: 'Others', pageviews: hours * 3, visitors: 1 },
        ];
      }
      if (matchesFilter(LEGISLATORS_FILTER)) {
        data = [
          { requestPath: '/legislators', pageviews: hours, visitors: 1 },
          { requestPath: 'Others', pageviews: hours * 2, visitors: 1 },
        ];
      }
      if (matchesFilter(FIND_MY_LEGISLATOR_FILTER)) {
        data = [{ requestPath: '/find-my-legislator', pageviews: hours / 2, visitors: 1 }];
      }
      return {
        ok: true,
        json: async () => ({
          version: 1,
          query: { ...query, groupBy: ['requestPath'], limit },
          data,
        }),
      };
    }

    if (matchesFilter(MONEY_PAGES_FILTER) || matchesFilter(COMMITTEE_PROFILE_FILTER)) {
      return {
        ok: true,
        json: async () => ({
          version: 1,
          query: { ...query, groupBy: ['requestPath'], limit: 100 },
          data: [],
        }),
      };
    }
    const prefix = matchesFilter(BILL_FILTER) ? '/bills' : '/legislators';
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
      estimatedVisitors24h: 7,
      estimatedVisitors7d: 19,
      estimatedVisitors30d: 43,
      trafficBreakdown7d: {
        committeeProfiles: EMPTY_COMMITTEE_PROFILES,
        destinationPageViews: {
          home: 168,
          billSearch: 168,
          billProfiles: 504,
          legislatorSearch: 0,
          legislatorProfiles: 504,
          findMyLegislator: 84,
          money: 0,
          ...EMPTY_MONEY_DETAILS,
          read: 0,
          legacyAsk: 0,
          other: 252,
        },
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
        committeeProfiles: EMPTY_COMMITTEE_PROFILES,
        destinationPageViews: {
          home: 720,
          billSearch: 720,
          billProfiles: 2160,
          legislatorSearch: 0,
          legislatorProfiles: 2160,
          findMyLegislator: 360,
          money: 0,
          ...EMPTY_MONEY_DETAILS,
          read: 0,
          legacyAsk: 0,
          other: 1080,
        },
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
      'public, max-age=0, s-maxage=300, stale-while-revalidate=60, stale-if-error=86400',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(30);
    expect(fetchSpy.mock.calls.every(([input]) => !String(input).includes('/visits/count'))).toBe(
      true,
    );
    expect(
      fetchSpy.mock.calls.filter(([input]) => {
        const url = new URL(String(input));
        return (
          url.searchParams.get('by') === 'environment' &&
          url.searchParams.get('filter') === PRODUCTION_FILTER
        );
      }),
    ).toHaveLength(3);
    for (const call of fetchSpy.mock.calls) {
      const [input, init] = call;
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.vercel.com');
      expect(url.searchParams.get('projectId')).toBe('prj_test');
      expect(url.searchParams.get('teamId')).toBe('team_test');
      const filter = url.searchParams.get('filter');
      if (url.searchParams.get('by') === 'requestPath') {
        expect([
          HOME_FILTER,
          BILLS_FILTER,
          LEGISLATORS_FILTER,
          FIND_MY_LEGISLATOR_FILTER,
          BILL_FILTER,
          LEGISLATOR_FILTER,
          MONEY_FILTER,
          MONEY_PAGES_FILTER,
          COMMITTEE_PROFILE_FILTER,
          READ_FILTER,
          LEGACY_ASK_FILTER,
        ]).toContain(filter);
      } else {
        expect(filter).toBe(PRODUCTION_FILTER);
      }
      expect(Number(url.searchParams.get('until')) + 1).toBeLessThanOrEqual(
        new Date('2026-08-14T20:00:00.000Z').getTime(),
      );
      expect(init).toMatchObject({
        headers: { Authorization: 'Bearer private-test-token', Accept: 'application/json' },
      });
    }
  });

  it('adds filtered Others rows to money, reading, and Ask without losing the overall total', async () => {
    const additions = new Map([
      [
        MONEY_FILTER,
        [
          { requestPath: '/money', pageviews: 12 },
          { requestPath: 'Others', pageviews: 38 },
        ],
      ],
      [
        READ_FILTER,
        [
          { requestPath: '/read/guides/test', pageviews: 7 },
          { requestPath: 'Others', pageviews: 33 },
        ],
      ],
      [
        LEGACY_ASK_FILTER,
        [
          { requestPath: '/ask', pageviews: 90 },
          { requestPath: 'Others', pageviews: 10 },
        ],
      ],
    ]);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const response = successfulVercelResponse(String(input));
      const data = additions.get(url.searchParams.get('filter') ?? '');
      return data
        ? { ...response, json: async () => ({ ...(await response.json()), data }) }
        : response;
    });
    vi.stubGlobal('fetch', fetcher);
    const recorder = responseRecorder();
    await handler({ method: 'GET' }, recorder.response);
    const { body, status } = recorder.read();
    expect(status).toBe(200);
    for (const [window, total, other] of [
      ['7d', 1680, 62],
      ['30d', 7200, 890],
    ] as const) {
      const breakdown = body[`trafficBreakdown${window}`] as {
        destinationPageViews: Record<string, number>;
      };
      expect(breakdown.destinationPageViews).toMatchObject({
        money: 0,
        moneyOther: 50,
        read: 40,
        legacyAsk: 100,
        other,
      });
      expect(
        Object.values(breakdown.destinationPageViews).reduce((sum, value) => sum + value, 0),
      ).toBe(total);
    }
    expect(JSON.stringify(body)).not.toContain('/read/guides/test');
    for (const filter of additions.keys()) {
      expect(
        fetcher.mock.calls.filter(
          ([input]) => new URL(String(input)).searchParams.get('filter') === filter,
        ),
      ).toHaveLength(2);
    }
  });

  it.each([
    [MONEY_FILTER, '/money', 'moneyOther'],
    [MONEY_FILTER, '/money/search', 'moneyOther'],
    [READ_FILTER, '/read', 'read'],
    [READ_FILTER, '/read/reports/test', 'read'],
    [LEGACY_ASK_FILTER, '/ask', 'legacyAsk'],
    [LEGACY_ASK_FILTER, '/ask/sessions/test', 'legacyAsk'],
  ])('counts an exact root or its slash child once: %s %s', async (filter, path, destination) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const response = successfulVercelResponse(String(input));
        if (new URL(String(input)).searchParams.get('filter') !== filter) return response;
        return {
          ...response,
          json: async () => ({
            ...(await response.json()),
            data: [{ requestPath: path, pageviews: 1 }],
          }),
        };
      }),
    );
    const recorder = responseRecorder();
    await handler({ method: 'GET' }, recorder.response);
    const { body, status } = recorder.read();
    expect(status).toBe(200);
    const breakdown = body.trafficBreakdown7d as { destinationPageViews: Record<string, number> };
    expect(breakdown.destinationPageViews[destination]).toBe(1);
    expect(breakdown.destinationPageViews.other).toBe(251);
    expect(
      Object.values(breakdown.destinationPageViews).reduce((sum, value) => sum + value, 0),
    ).toBe(1680);
  });

  it('refuses destination counts that exceed the completed-hour total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const response = successfulVercelResponse(String(input));
        if (new URL(String(input)).searchParams.get('filter') !== MONEY_FILTER) return response;
        return {
          ...response,
          json: async () => ({
            ...(await response.json()),
            data: [{ requestPath: '/money', pageviews: 1680 }],
          }),
        };
      }),
    );
    const recorder = responseRecorder();
    await handler({ method: 'GET' }, recorder.response);
    expect(recorder.read()).toMatchObject({
      status: 503,
      body: { error: 'Traffic data is temporarily unavailable.' },
    });
  });

  it.each(['1', '100'])(
    'requires the full compound filter echoed for path limit %s',
    async (limit) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) => {
          const response = successfulVercelResponse(String(input));
          const url = new URL(String(input));
          if (
            url.searchParams.get('by') !== 'requestPath' ||
            url.searchParams.get('limit') !== limit
          )
            return response;
          const payload = await response.json();
          return {
            ...response,
            json: async () => ({
              ...payload,
              query: { ...payload.query, filter: PRODUCTION_FILTER },
            }),
          };
        }),
      );
      const recorder = responseRecorder();
      await handler({ method: 'GET' }, recorder.response);
      expect(recorder.read().status).toBe(503);
    },
  );

  it.each([
    [MONEY_FILTER, '/moneyed'],
    [MONEY_FILTER, '/read'],
    [READ_FILTER, '/readers'],
    [READ_FILTER, '/money'],
    [LEGACY_ASK_FILTER, '/asking'],
    [LEGACY_ASK_FILTER, '/bills'],
  ])('rejects a path outside its destination: %s %s', async (filter, path) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const response = successfulVercelResponse(String(input));
        if (new URL(String(input)).searchParams.get('filter') !== filter) return response;
        return {
          ...response,
          json: async () => ({
            ...(await response.json()),
            data: [{ requestPath: path, pageviews: 1 }],
          }),
        };
      }),
    );
    const recorder = responseRecorder();
    await handler({ method: 'GET' }, recorder.response);
    expect(recorder.read().status).toBe(503);
  });

  it.each(['hour', 'environment', 'requestPath'])(
    'rejects an absent or changed echoed production filter for %s',
    async (by) => {
      for (const filter of [undefined, "environment eq 'preview'"]) {
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input: string | URL | Request) => {
            const response = successfulVercelResponse(String(input));
            if (new URL(String(input)).searchParams.get('by') !== by) return response;
            const payload = await response.json();
            return {
              ...response,
              json: async () => ({ ...payload, query: { ...payload.query, filter } }),
            };
          }),
        );
        const recorder = responseRecorder();
        await handler({ method: 'GET' }, recorder.response);
        expect(recorder.read().status).toBe(503);
      }
    },
  );

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
        committeeProfiles: EMPTY_COMMITTEE_PROFILES,
        destinationPageViews: {
          home: 0,
          billSearch: 0,
          billProfiles: 0,
          legislatorSearch: 0,
          legislatorProfiles: 0,
          findMyLegislator: 0,
          other: 0,
        },
        billProfiles: {
          pageViews: 0,
          differentProfilesViewed: { count: 0, capped: false, cap: 100 },
        },
      },
    });
  });

  it('uses one full-period visitor total instead of adding hourly visitor rows', async () => {
    const fetchSpy = vi.fn((input: string | URL | Request) =>
      Promise.resolve(successfulVercelResponse(String(input))),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ method: 'GET' }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      estimatedVisitors24h: 7,
      estimatedVisitors7d: 19,
      estimatedVisitors30d: 43,
    });
    const visitorRanges = fetchSpy.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.searchParams.get('by') === 'environment')
      .map((url) => requestedRange(url).hours)
      .sort((left, right) => left - right);
    expect(visitorRanges).toEqual([24, 168, 720]);
  });

  it('marks profile breadth as capped when Vercel groups paths beyond its limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = new URL(String(input));
        const response = successfulVercelResponse(String(input));
        if (
          url.searchParams.get('by') !== 'requestPath' ||
          url.searchParams.get('limit') !== '100'
        ) {
          return Promise.resolve(response);
        }
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
      'a full-period visitor total is malformed',
      (input: string | URL | Request) => {
        const url = new URL(String(input));
        const response = successfulVercelResponse(String(input));
        if (url.searchParams.get('by') !== 'environment') {
          return Promise.resolve(response);
        }
        return Promise.resolve({
          ...response,
          json: async () => {
            const payload = await response.json();
            const rows = payload.data as Array<Record<string, unknown>>;
            return {
              ...payload,
              data: [{ ...rows[0], visitors: 'many' }],
            };
          },
        });
      },
    ],
    [
      'a private path row omits its path',
      (input: string | URL | Request) => {
        const url = new URL(String(input));
        const response = successfulVercelResponse(String(input));
        if (
          url.searchParams.get('by') !== 'requestPath' ||
          url.searchParams.get('limit') !== '100'
        ) {
          return Promise.resolve(response);
        }
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

type MoneyRow = { requestPath: string; pageviews: number };
type MoneyFixtureOptions = {
  exact?: MoneyRow[];
  profiles?: MoneyRow[];
  broad?: number;
  transform?: (
    url: URL,
    payload: { version: number; query: Record<string, unknown>; data: unknown },
  ) => unknown;
};

const NAVIGATION_ROWS: MoneyRow[] = Object.values(MONEY_PAGES).map((requestPath, index) => ({
  requestPath,
  pageviews: [2, 3, 5, 7, 11, 13][index],
}));
const PROFILE_ROWS: MoneyRow[] = [
  { requestPath: '/money/committees/private-name-1001', pageviews: 3 },
  { requestPath: '/money/committees/private-name-1001/payments', pageviews: 5 },
  { requestPath: '/money/committees/1001', pageviews: 7 },
  { requestPath: '/money/committees/another-private-name-2002', pageviews: 11 },
];

function moneyFetcher(options: MoneyFixtureOptions = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const response = successfulVercelResponse(String(input));
    const payload = await response.json();
    const filter = url.searchParams.get('filter');
    const factor = requestedRange(url).hours === 168 ? 1 : 3;
    let rows: MoneyRow[] | undefined;
    if (filter === MONEY_PAGES_FILTER) rows = options.exact ?? NAVIGATION_ROWS;
    if (filter === COMMITTEE_PROFILE_FILTER) rows = options.profiles ?? PROFILE_ROWS;
    if (filter === MONEY_FILTER)
      rows = [
        { requestPath: '/money', pageviews: 1 },
        { requestPath: 'Others', pageviews: (options.broad ?? 200) - 1 },
      ];
    const data = rows
      ? rows.map((row) => ({ ...row, pageviews: row.pageviews * factor }))
      : payload.data;
    const next = { ...payload, data };
    return {
      ...response,
      json: async () => (options.transform ? options.transform(url, next) : next),
    };
  });
}

async function moneyResult(options: MoneyFixtureOptions = {}) {
  const fetcher = moneyFetcher(options);
  vi.stubGlobal('fetch', fetcher);
  const recorder = responseRecorder();
  await handler({ method: 'GET' }, recorder.response);
  return { ...recorder.read(), fetcher };
}

type MoneyBreakdown = {
  destinationPageViews: Record<string, number>;
  committeeProfiles?: {
    pageViews: number;
    differentProfilesViewed: { count: number; capped: boolean; cap: number };
  };
};

function moneyBreakdown(body: JsonBody, period: '7d' | '30d'): MoneyBreakdown {
  return body['trafficBreakdown' + period] as MoneyBreakdown;
}

describe('private-source public money aggregates', () => {
  it('partitions all 6 navigation pages, committee views and remainder in both periods', async () => {
    const { body, status, fetcher } = await moneyResult();
    expect(status).toBe(200);
    for (const [period, factor, total, overallOther] of [
      ['7d', 1, 1680, 52],
      ['30d', 3, 7200, 480],
    ] as const) {
      const breakdown = moneyBreakdown(body, period);
      expect(breakdown.destinationPageViews).toMatchObject({
        money: 2 * factor,
        moneySearch: 3 * factor,
        moneyByRace: 5 * factor,
        moneyCommitteeList: 7 * factor,
        moneyPayments: 11 * factor,
        moneyOutsideSpending: 13 * factor,
        moneyCommitteeProfiles: 26 * factor,
        moneyOther: 133 * factor,
        other: overallOther,
      });
      expect(
        Object.values(breakdown.destinationPageViews).reduce((sum, value) => sum + value, 0),
      ).toBe(total);
      expect(breakdown.committeeProfiles).toEqual({
        pageViews: 26 * factor,
        differentProfilesViewed: { count: 2, capped: false, cap: 100 },
      });
    }
    expect(fetcher).toHaveBeenCalledTimes(30);
    for (const filter of [MONEY_PAGES_FILTER, COMMITTEE_PROFILE_FILTER]) {
      const requests = fetcher.mock.calls
        .map(([input]) => new URL(String(input)))
        .filter((url) => url.searchParams.get('filter') === filter);
      expect(requests.map((url) => requestedRange(url).hours).sort((a, b) => a - b)).toEqual([
        168, 720,
      ]);
      for (const url of requests) {
        expect(url.searchParams.get('by')).toBe('requestPath');
        expect(url.searchParams.get('limit')).toBe('100');
        expect(url.searchParams.get('filter')).toContain(PRODUCTION_FILTER);
        expect(url.searchParams.get('projectId')).toBe('prj_test');
        expect(url.searchParams.get('teamId')).toBe('team_test');
      }
    }
  });

  it('keeps quiet navigation pages visible beside more than 100 committee paths', async () => {
    const profiles = [
      ...Array.from({ length: 100 }, (_, index) => ({
        requestPath: '/money/committees/private-' + (index + 10000),
        pageviews: 1,
      })),
      { requestPath: 'Others', pageviews: 23 },
    ];
    const { body, status, fetcher } = await moneyResult({ profiles });
    expect(status).toBe(200);
    for (const [period, factor] of [
      ['7d', 1],
      ['30d', 3],
    ] as const) {
      const breakdown = moneyBreakdown(body, period);
      expect(breakdown.destinationPageViews).toMatchObject({
        moneySearch: 3 * factor,
        moneyCommitteeList: 7 * factor,
        moneyCommitteeProfiles: 123 * factor,
        moneyOther: 36 * factor,
      });
      expect(breakdown.committeeProfiles?.differentProfilesViewed).toEqual({
        count: 100,
        capped: true,
        cap: 100,
      });
    }
    expect(fetcher).toHaveBeenCalledTimes(30);
    expect(JSON.stringify(body)).not.toContain('private-');
  });

  it('deduplicates renamed aliases, bare IDs and payment subpages by committee ID', async () => {
    const profiles = [
      { requestPath: '/money/committees/old-name-4411', pageviews: 2 },
      { requestPath: '/money/committees/new-name-4411', pageviews: 3 },
      { requestPath: '/money/committees/4411', pageviews: 5 },
      { requestPath: '/money/committees/new-name-4411/payments/unknown-subpage', pageviews: 7 },
      { requestPath: '/money/committees/other-name-5522', pageviews: 11 },
    ];
    const { body, status } = await moneyResult({ profiles });
    expect(status).toBe(200);
    expect(moneyBreakdown(body, '7d').committeeProfiles).toEqual({
      pageViews: 28,
      differentProfilesViewed: { count: 2, capped: false, cap: 100 },
    });
  });

  it('preserves known Others committee views without inventing unseen identities', async () => {
    const { body, status } = await moneyResult({
      profiles: [{ requestPath: 'Others', pageviews: 100 }],
    });
    expect(status).toBe(200);
    expect(moneyBreakdown(body, '7d').committeeProfiles).toEqual({
      pageViews: 100,
      differentProfilesViewed: { count: 0, capped: true, cap: 100 },
    });
    expect(moneyBreakdown(body, '7d').destinationPageViews.moneyOther).toBe(59);
  });

  it('returns exact zero categories for successfully empty detail queries', async () => {
    const { body, status } = await moneyResult({ exact: [], profiles: [] });
    expect(status).toBe(200);
    expect(moneyBreakdown(body, '7d')).toMatchObject({
      destinationPageViews: { ...EMPTY_MONEY_DETAILS, money: 0, moneyOther: 200 },
      committeeProfiles: EMPTY_COMMITTEE_PROFILES,
    });
  });

  it.each([MONEY_PAGES_FILTER, COMMITTEE_PROFILE_FILTER])(
    'falls back to the broad money count only in the failed period: %s',
    async (filter) => {
      const { body, status } = await moneyResult({
        transform: (url, payload) => {
          if (url.searchParams.get('filter') === filter && requestedRange(url).hours === 168)
            throw new Error('private provider failure');
          return payload;
        },
      });
      expect(status).toBe(200);
      const seven = moneyBreakdown(body, '7d');
      expect(seven.destinationPageViews.money).toBe(200);
      expect(seven.destinationPageViews).not.toHaveProperty('moneySearch');
      expect(seven).not.toHaveProperty('committeeProfiles');
      expect(Object.values(seven.destinationPageViews).reduce((sum, value) => sum + value, 0)).toBe(
        1680,
      );
      expect(moneyBreakdown(body, '30d').destinationPageViews.moneySearch).toBe(9);
      expect(moneyBreakdown(body, '30d').committeeProfiles?.pageViews).toBe(78);
      expect(JSON.stringify(body)).not.toContain('private provider failure');
    },
  );

  it.each([
    ['unexpected Others in exact pages', [{ requestPath: 'Others', pageviews: 10 }]],
    [
      'private unrequested path',
      [{ requestPath: '/money/secret-address?private=query', pageviews: 10 }],
    ],
    [
      'duplicate exact page',
      [
        { requestPath: '/money', pageviews: 2 },
        { requestPath: '/money', pageviews: 2 },
      ],
    ],
    ['negative page views', [{ requestPath: '/money', pageviews: -1 }]],
    ['fractional page views', [{ requestPath: '/money', pageviews: 1.5 }]],
  ])('retains broad money totals when detail rows contain %s', async (_label, exact) => {
    const { body, status } = await moneyResult({ exact: exact as MoneyRow[] });
    expect(status).toBe(200);
    expect(moneyBreakdown(body, '7d').destinationPageViews.money).toBe(200);
    expect(moneyBreakdown(body, '7d').destinationPageViews).not.toHaveProperty('moneyOther');
    expect(JSON.stringify(body)).not.toContain('secret-address');
  });

  it.each([
    ['wrong production filter', { filter: "environment eq 'preview'" }],
    ['wrong group', { groupBy: ['country'] }],
    ['wrong limit', { limit: 1 }],
    ['wrong range', { until: '2026-08-13T20:00:00.000Z' }],
  ])(
    'refuses money detail metadata with %s without dropping broad totals',
    async (_label, query) => {
      const { body, status } = await moneyResult({
        transform: (url, payload) =>
          url.searchParams.get('filter') === MONEY_PAGES_FILTER
            ? { ...payload, query: { ...payload.query, ...query } }
            : payload,
      });
      expect(status).toBe(200);
      expect(moneyBreakdown(body, '7d').destinationPageViews.money).toBe(200);
      expect(moneyBreakdown(body, '7d')).not.toHaveProperty('committeeProfiles');
    },
  );

  it.each([
    [{ requestPath: '/legislators/private-1001', pageviews: 4 }],
    [{ requestPath: '/money/committees/', pageviews: 4 }],
    [
      { requestPath: '/money/committees/private-1001', pageviews: 4 },
      { requestPath: '/money/committees/private-1001', pageviews: 5 },
    ],
  ])('refuses malformed committee rows without inventing detail zeroes', async (...profiles) => {
    const { body, status } = await moneyResult({ profiles: profiles as MoneyRow[] });
    expect(status).toBe(200);
    expect(moneyBreakdown(body, '7d').destinationPageViews.money).toBe(200);
    expect(moneyBreakdown(body, '7d')).not.toHaveProperty('committeeProfiles');
  });

  it('rejects successful detail sums above the broad money total instead of a negative remainder', async () => {
    const { body, status, headers } = await moneyResult({ broad: 66 });
    expect(status).toBe(503);
    expect(body).toEqual({ error: 'Traffic data is temporarily unavailable.' });
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  it('accepts a fully accounted money total with zero remainder', async () => {
    const { body, status } = await moneyResult({ broad: 67 });
    expect(status).toBe(200);
    expect(moneyBreakdown(body, '7d').destinationPageViews.moneyOther).toBe(0);
    expect(moneyBreakdown(body, '30d').destinationPageViews.moneyOther).toBe(0);
  });

  it('emits only aggregate counts, never requested paths, IDs, keys or provider metadata', async () => {
    const { body, status } = await moneyResult();
    expect(status).toBe(200);
    const output = JSON.stringify(body);
    for (const secret of [
      '/money',
      'private-name',
      '1001',
      '2002',
      'requestPath',
      'filter',
      'query',
      'private-test-token',
      'prj_test',
      'team_test',
    ])
      expect(output).not.toContain(secret);
  });
});
