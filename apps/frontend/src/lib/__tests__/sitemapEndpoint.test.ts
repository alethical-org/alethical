import { afterEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/sitemap';
import { indexedResearch, piecePath } from '../research';

/**
 * The rows that are not a published piece: every fixed public page. Counted this
 * way rather than typed, so publishing a piece adds a row here the same way it
 * adds one to the sitemap, and this stops failing on every publish for a reason
 * that is not a defect.
 */
const FIXED_PAGE_ROWS = 17;
/** The numbered directory rows the live counts add: 2 for bills, 1 for
 *  legislators, 2 for the register of campaign committees. */
const DIRECTORY_PAGE_ROWS = 5;

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
  return { response, read: () => ({ body, headers, status }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sitemap endpoint', () => {
  it('lists exactly the seven child sitemaps and makes no network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ query: {} }, recorder.response);

    const { body, status, headers } = recorder.read();
    expect(status).toBe(200);
    expect(headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(body).toContain('<loc>https://www.alethical.com/sitemaps/pages.xml</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/sitemaps/bills.xml</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/sitemaps/legislators.xml</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/sitemaps/committees.xml</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/sitemaps/races.xml</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/sitemaps/lobbying-principals.xml</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/sitemaps/lobbying-lobbyists.xml</loc>');
    expect(body.match(/<sitemap>/g)).toHaveLength(7);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists fixed pages plus every numbered directory page from current record counts', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          bill_directory_total: 21,
          legislator_directory_total: 13,
          committee_directory_total: 120,
          bills: Array.from({ length: 21 }, (_, index) => ({ id: `bill-${index + 1}` })),
          legislators: Array.from({ length: 13 }, (_, index) => ({ slug: `member-${index + 1}` })),
          committees: [{ registration_number: '18833', name: 'Andrew Smith House Committee' }],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ query: { section: 'pages' } }, recorder.response);

    const { body } = recorder.read();
    for (const path of [
      '/',
      '/bills',
      '/legislators',
      '/find-my-legislator',
      '/money',
      '/money/lobbying',
      '/money/lobbying/principals',
      '/money/lobbying/lobbyists',
      '/money/committees',
      '/read',
      '/about',
      '/about/contact',
      '/privacy',
      '/site-metrics',
      '/terms',
    ]) {
      expect(body).toContain(`<loc>https://www.alethical.com${path}</loc>`);
    }
    expect(body).toContain('<loc>https://www.alethical.com/bills?page=2</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/bills?page=3</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/legislators?page=2</loc>');
    // Every numbered page of the register, counted from the WHOLE register rather
    // than from the shorter indexable list: 120 filers at 50 a page is 3 pages.
    expect(body).toContain('<loc>https://www.alethical.com/money/committees?page=2</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/money/committees?page=3</loc>');
    expect(body).not.toContain('<loc>https://www.alethical.com/money/committees?page=4</loc>');
    // A published piece is in the sitemap from the day it posts, so the count
    // grows with every piece we publish rather than staying fixed.
    expect(body).toContain(
      '<loc>https://www.alethical.com/read/research/the-money-only-goes-one-way</loc>',
    );
    // A guide is listed at its own folder, from the same registry.
    expect(body).toContain(
      '<loc>https://www.alethical.com/read/guides/who-has-to-report-their-money</loc>',
    );
    expect(body).toContain('<loc>https://www.alethical.com/read/topics/campaign-finance</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/read/topics/lobbying</loc>');
    expect(body).toContain('<loc>https://www.alethical.com/read/topics/elections</loc>');
    expect(body).not.toContain('<loc>https://www.alethical.com/read/short-posts</loc>');
    expect(body.match(/<url>/g)).toHaveLength(
      FIXED_PAGE_ROWS + DIRECTORY_PAGE_ROWS + indexedResearch().length + 3,
    );
    // Money by race is one fixed page: an office chip is a filtered view and is
    // never listed (issue #1954).
    expect(body).toContain('<loc>https://www.alethical.com/money/races</loc>');
    expect(body).not.toContain('/money/races?');
    // Outside spending is one fixed record: its filtered views stay out, but
    // the bare canonical address belongs in the sitemap (issue #1945).
    expect(body).toContain('<loc>https://www.alethical.com/money/outside-spending</loc>');
    expect(body).not.toContain('/money/outside-spending?');
    // Every piece a search engine may list, at its own folder, from the registry.
    for (const piece of indexedResearch()) {
      expect(body).toContain(`<loc>https://www.alethical.com${piecePath(piece)}</loc>`);
    }
    // Every address the /read page and its pieces used to answer on is
    // forwarded, never listed: a sitemap row for an address that answers with a
    // permanent forward asks Google to crawl a redirect
    // (docs/architecture/published-writing-decisions.md §2.1).
    for (const retired of [
      '/reports',
      '/reports/the-money-only-goes-one-way',
      '/money/reports',
      '/reading',
      '/reading/research/the-money-only-goes-one-way',
      '/reading/guides/who-has-to-report-their-money',
    ]) {
      expect(body).not.toContain(`<loc>https://www.alethical.com${retired}</loc>`);
    }
    expect(body).not.toContain('<lastmod>');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('keeps the fixed public pages available when directory counts cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const recorder = responseRecorder();

    await handler({ query: { section: 'pages' } }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    expect(body.match(/<url>/g)).toHaveLength(FIXED_PAGE_ROWS + indexedResearch().length + 3);
    expect(body).toContain(
      '<loc>https://www.alethical.com/read/research/the-money-only-goes-one-way</loc>',
    );
    expect(body).toContain(
      '<loc>https://www.alethical.com/read/guides/who-has-to-report-their-money</loc>',
    );
    expect(body).not.toContain('?page=');
  });

  it('lists all lobbying directory pages from the whole live counts at 50 names per page', async () => {
    const fetchSpy = vi.fn(async (address: string) => {
      if (address.includes('/api/v1/lobbying/')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              state: 'reported',
              total: address.includes('/principals?') ? 3443 : 1665,
            },
          }),
        };
      }
      return { ok: false, status: 503 };
    });
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ query: { section: 'pages' } }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    for (const [kind, lastPage] of [
      ['principals', 69],
      ['lobbyists', 34],
    ] as const) {
      expect(
        body.match(new RegExp(`<loc>https://www.alethical.com/money/lobbying/${kind}</loc>`, 'g')),
      ).toHaveLength(1);
      expect(body).not.toContain(`/money/lobbying/${kind}?page=1</loc>`);
      for (let page = 2; page <= lastPage; page += 1) {
        expect(body).toContain(
          `<loc>https://www.alethical.com/money/lobbying/${kind}?page=${page}</loc>`,
        );
      }
      expect(body).not.toContain(`/money/lobbying/${kind}?page=${lastPage + 1}</loc>`);
    }
    expect(body.match(/<url>/g)).toHaveLength(
      FIXED_PAGE_ROWS + 68 + 33 + indexedResearch().length + 3,
    );
    expect(body).not.toContain('<lastmod>');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it.each([
    { state: 'unavailable', total: 3443 },
    { state: 'reported', total: null },
  ])(
    'keeps the fixed principal address and other lobbying pages when its count is $state/$total',
    async (principalCount) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (address: string) => {
          if (address.includes('/api/v1/lobbying/')) {
            return {
              ok: true,
              json: async () => ({
                data: address.includes('/principals?')
                  ? principalCount
                  : { state: 'reported', total: 1665 },
              }),
            };
          }
          return { ok: false, status: 503 };
        }),
      );
      const recorder = responseRecorder();

      await handler({ query: { section: 'pages' } }, recorder.response);

      const { body, status } = recorder.read();
      expect(status).toBe(200);
      expect(body).toContain('<loc>https://www.alethical.com/money/lobbying/principals</loc>');
      expect(body).not.toContain('/money/lobbying/principals?page=');
      expect(body).toContain(
        '<loc>https://www.alethical.com/money/lobbying/lobbyists?page=34</loc>',
      );
      expect(body.match(/<url>/g)).toHaveLength(
        FIXED_PAGE_ROWS + 33 + indexedResearch().length + 3,
      );
    },
  );

  it('renders a loc and lastmod per bill, omitting lastmod when absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            bills: [
              { id: '94-2025-HF719', lastmod: '2026-05-17' },
              { id: '94-2025-HF1', lastmod: '2026-05-17' },
            ],
            legislators: [],
          },
        }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ query: { section: 'bills' } }, recorder.response);

    const { body } = recorder.read();
    expect(body).toContain(
      '<url><loc>https://www.alethical.com/bills/94-2025-HF719</loc><lastmod>2026-05-17</lastmod></url>',
    );
    expect(body).toContain(
      '<url><loc>https://www.alethical.com/bills/94-2025-HF1</loc><lastmod>2026-05-17</lastmod></url>',
    );
  });

  it('omits lastmod when a bill entry has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { bills: [{ id: '94-2025-HF1' }], legislators: [] },
        }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ query: { section: 'bills' } }, recorder.response);

    expect(recorder.read().body).toContain(
      '<url><loc>https://www.alethical.com/bills/94-2025-HF1</loc></url>',
    );
  });

  it('percent-encodes a legislator slug or bill id that needs it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { bills: [], legislators: [{ slug: 'jane doe/smith', lastmod: '2026-07-14' }] },
        }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ query: { section: 'legislators' } }, recorder.response);

    expect(recorder.read().body).toContain(
      `<loc>https://www.alethical.com/legislators/${encodeURIComponent('jane doe/smith')}</loc>`,
    );
  });

  it('responds 503, not 404, with Retry-After and no-store when the backend call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const recorder = responseRecorder();

    await handler({ query: { section: 'bills' } }, recorder.response);

    const { status, headers } = recorder.read();
    expect(status).toBe(503);
    expect(headers.get('Retry-After')).toBe('120');
    expect(headers.get('Cache-Control')).toBe('no-store');
  });

  // A committee page is worth a sitemap entry when it holds a filed record. The
  // API decides that; this asserts the address is built by the same slug rule the
  // router reads, so the sitemap can never advertise an address it rejects.
  it('renders one dateless entry per indexable committee, by name and number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            bills: [],
            legislators: [],
            committees: [
              { registration_number: '18833', name: 'Andrew Smith (House Committee)' },
              { registration_number: '41363', name: '100 Percent Future Fund' },
            ],
          },
        }),
      }),
    );
    const recorder = responseRecorder();

    await handler({ query: { section: 'committees' } }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toContain(
      '<url><loc>https://www.alethical.com/money/committees/andrew-smith-house-committee-18833</loc></url>',
    );
    expect(body).toContain(
      '<url><loc>https://www.alethical.com/money/committees/100-percent-future-fund-41363</loc></url>',
    );
    // No lastmod anywhere: we hold no date on which a committee's own record
    // changed, and Google trusts the field site-wide only when it is accurate.
    expect(body).not.toContain('<lastmod>');
  });

  it('lists every seat at its own address, dateless and without a year', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          contests: [
            { anchor: 'house-1a' },
            { anchor: 'district-court-4-12' },
            // A contest the register answers without an identifier has no address,
            // so it is left out rather than listed as a broken one.
            { anchor: '' },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ query: { section: 'races' } }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    expect(body).toContain('<url><loc>https://www.alethical.com/money/races/house-1a</loc></url>');
    expect(body).toContain(
      '<url><loc>https://www.alethical.com/money/races/district-court-4-12</loc></url>',
    );
    expect(body.match(/<url>/g)).toHaveLength(2);
    // The bare seat address only: a `?year=` view names the same record (§22).
    expect(body).not.toContain('year=');
    expect(body).not.toContain('<lastmod>');
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/v1/campaign-finance/races?year=');
  });

  it('responds 503 rather than an empty seat sitemap when the backend fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const recorder = responseRecorder();

    await handler({ query: { section: 'races' } }, recorder.response);

    expect(recorder.read().status).toBe(503);
  });

  it('responds 503 rather than an empty committee sitemap when the backend fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const recorder = responseRecorder();

    await handler({ query: { section: 'committees' } }, recorder.response);

    expect(recorder.read().status).toBe(503);
  });

  // A lobbying record page is worth a sitemap entry when it exists and is
  // indexable: a principal with spending rows, a lobbyist on the current list.
  // The API decides that; this asserts the address is built by the same slug
  // rule the router reads, so the sitemap can never advertise an address it
  // rejects, and that neither section carries a date.
  it('renders one dateless entry per indexable lobbying record, by name and number', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          state: 'reported',
          principals: [
            { entity_id: 2263, name: 'American Express' },
            { entity_id: 7325, name: 'ACTwireless' },
          ],
          lobbyists: [{ registration_number: '141', name: 'Kozak, Andrew' }],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const principals = responseRecorder();
    await handler({ query: { section: 'lobbying-principals' } }, principals.response);
    expect(principals.read().status).toBe(200);
    expect(principals.read().body).toContain(
      '<url><loc>https://www.alethical.com/money/lobbying/principals/american-express-2263</loc></url>',
    );
    expect(principals.read().body).toContain(
      '<url><loc>https://www.alethical.com/money/lobbying/principals/actwireless-7325</loc></url>',
    );
    expect(principals.read().body).not.toContain('/money/lobbying/lobbyists/');
    expect(principals.read().body).not.toContain('<lastmod>');

    const lobbyists = responseRecorder();
    await handler({ query: { section: 'lobbying-lobbyists' } }, lobbyists.response);
    expect(lobbyists.read().status).toBe(200);
    expect(lobbyists.read().body).toContain(
      '<url><loc>https://www.alethical.com/money/lobbying/lobbyists/kozak-andrew-141</loc></url>',
    );
    expect(lobbyists.read().body).not.toContain('/money/lobbying/principals/');
    expect(lobbyists.read().body.match(/<url>/g)).toHaveLength(1);
    // Both sections read the one lobbying sitemap endpoint, never the paged directories.
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toBe('https://api.alethical.com/api/v1/lobbying/sitemap');
    }
  });

  it('responds 503 rather than an empty lobbying sitemap when the backend fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    for (const section of ['lobbying-principals', 'lobbying-lobbyists']) {
      const recorder = responseRecorder();
      await handler({ query: { section } }, recorder.response);
      expect(recorder.read().status).toBe(503);
    }
  });

  it('responds 404 for an unknown section', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ query: { section: 'nonsense' } }, recorder.response);

    expect(recorder.read().status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
