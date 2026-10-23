import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bingSearchExport,
  googleSearchExport,
  searchExportRequest,
  SEARCH_ROW_LIMIT,
  SEARCH_MAX_PAGES,
} from '../../../../../api/_lib/searchMeasurement';

const now = new Date('2026-10-23T12:00:00Z');
const datePayload = {
  rows: [{ keys: ['2026-10-20'], clicks: 1, impressions: 5, ctr: 0.2, position: 1 }],
  metadata: { first_incomplete_date: '2026-10-21' },
};
const row = (key: string) => ({ keys: [key], clicks: 1, impressions: 5, ctr: 0.2, position: 2 });
const response = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => vi.unstubAllGlobals());

describe('private search exports', () => {
  it('rejects arbitrary modes and unbounded windows', () => {
    expect(searchExportRequest('/api/traffic-google')).toBeNull();
    expect(searchExportRequest('/?view=queries')).toEqual({ view: 'queries', days: 7 });
    for (const suffix of [
      'view=foo',
      'view=queries&days=0',
      'view=queries&days=91',
      'view=queries&days=2.5',
    ]) {
      expect(() => searchExportRequest(`/?${suffix}`)).toThrow();
    }
  });
  it('uses a Pacific final cutoff and exposes dates with no returned rows as unknown', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(datePayload))
      .mockResolvedValueOnce(
        response({
          rows: [
            {
              ...row('a private query'),
              keys: ['a private query', 'https://alethical.com/bills/1'],
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await googleSearchExport(
      'sc-domain:alethical.com',
      'secret',
      { view: 'query-pages', days: 7 },
      now,
    );
    expect(result).toMatchObject({
      startDate: '2026-10-14',
      endDate: '2026-10-20',
      timeZone: 'America/Los_Angeles',
      finalDataCutoff: '2026-10-20',
      cutoffBasis: 'provider-first-incomplete-date',
      coverage: {
        exhaustive: false,
        rowLimitReached: false,
        datesWithoutRows: [
          '2026-10-14',
          '2026-10-15',
          '2026-10-16',
          '2026-10-17',
          '2026-10-18',
          '2026-10-19',
        ],
      },
    });
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body).toMatchObject({
      dataState: 'final',
      dimensions: ['query', 'page'],
      aggregationType: 'auto',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes('private query'))).toBe(true);
  });
  it('halts at its page budget and never calls capped rows exhaustive', async () => {
    let page = 0;
    const fetcher = vi.fn().mockImplementation(async () =>
      page++ === 0
        ? response(datePayload)
        : response({
            rows: Array.from({ length: SEARCH_ROW_LIMIT }, (_, index) => row(`${page}-${index}`)),
          }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await googleSearchExport('site', 'secret', { view: 'queries', days: 7 }, now);
    expect(fetcher).toHaveBeenCalledTimes(1 + SEARCH_MAX_PAGES);
    expect(result.coverage).toMatchObject({ rowLimitReached: true, exhaustive: false });
    expect(result.rows).toHaveLength(SEARCH_ROW_LIMIT * SEARCH_MAX_PAGES);
    expect(JSON.parse(fetcher.mock.calls[SEARCH_MAX_PAGES][1].body).startRow).toBe(
      (SEARCH_MAX_PAGES - 1) * SEARCH_ROW_LIMIT,
    );
  });
  it('rejects a repeated page instead of double counting', async () => {
    const batch = { rows: Array.from({ length: SEARCH_ROW_LIMIT }, (_, index) => row(`${index}`)) };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response(datePayload))
        .mockResolvedValueOnce(response(batch))
        .mockResolvedValueOnce(response(batch)),
    );
    await expect(
      googleSearchExport('site', 'secret', { view: 'queries', days: 7 }, now),
    ).rejects.toThrow('Duplicate');
  });
  it('rejects malformed final-date metadata and provider failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response({ ...datePayload, metadata: { first_incomplete_date: '2026-02-30' } }),
        ),
    );
    await expect(
      googleSearchExport('site', 'secret', { view: 'queries', days: 7 }, now),
    ).rejects.toThrow();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private vendor error', { status: 503 })),
    );
    await expect(
      googleSearchExport('site', 'secret', { view: 'queries', days: 7 }, now),
    ).rejects.toThrow('unavailable');
  });
  it('retains Bing provider dates and does not pretend a date filter or final cutoff exists', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        d: [
          {
            Query: 'private query',
            Date: '/Date(1792454400000-0700)/',
            Clicks: 2,
            Impressions: 10,
            AvgClickPosition: 2,
            AvgImpressionPosition: 3,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await bingSearchExport(
      'https://alethical.com',
      'private-key',
      { view: 'queries', days: 90 },
      now,
    );
    expect(result).toMatchObject({
      finalDataCutoff: null,
      timeZone: null,
      dataState: 'unknown',
      coverage: { exhaustive: false, appliedDateFilter: false, requestedDays: 90 },
    });
    expect(result.rows[0].providerDate).toBe('/Date(1792454400000-0700)/');
    expect(JSON.stringify(result)).not.toContain('private-key');
    const requested = new URL(String(fetcher.mock.calls[0][0]));
    expect(requested.pathname).toContain('GetQueryStats');
    expect([...requested.searchParams.keys()]).toEqual(['siteUrl', 'apikey']);
  });
  it('rejects malformed Bing counts and never makes a query-page fan-out', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      bingSearchExport('site', 'key', { view: 'query-pages', days: 7 }, now),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(response({ d: [{ Query: 'test', Clicks: -1 }] }));
    await expect(
      bingSearchExport('site', 'key', { view: 'pages', days: 7 }, now),
    ).rejects.toThrow();
  });
});
