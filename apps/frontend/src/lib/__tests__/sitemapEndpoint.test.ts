import { afterEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/sitemap';
import { indexedResearch, piecePath } from '../research';

/**
 * The rows that are not a published piece: every fixed public page. Counted this
 * way rather than typed, so publishing a piece adds a row here the same way it
 * adds one to the sitemap, and this stops failing on every publish for a reason
 * that is not a defect.
 */
const FIXED_PAGE_ROWS = 13;
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
  it('lists exactly the four child sitemaps and makes no network call', async () => {
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
    expect(body.match(/<sitemap>/g)).toHaveLength(4);
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
    expect(body.match(/<url>/g)).toHaveLength(
      FIXED_PAGE_ROWS + DIRECTORY_PAGE_ROWS + indexedResearch().length,
    );
    // Money by race is one fixed page: an office chip is a filtered view and is
    // never listed (issue #1954).
    expect(body).toContain('<loc>https://www.alethical.com/money/races</loc>');
    expect(body).not.toContain('/money/races?');
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
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the fixed public pages available when directory counts cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const recorder = responseRecorder();

    await handler({ query: { section: 'pages' } }, recorder.response);

    const { body, status } = recorder.read();
    expect(status).toBe(200);
    expect(body.match(/<url>/g)).toHaveLength(FIXED_PAGE_ROWS + indexedResearch().length);
    expect(body).toContain(
      '<loc>https://www.alethical.com/read/research/the-money-only-goes-one-way</loc>',
    );
    expect(body).toContain(
      '<loc>https://www.alethical.com/read/guides/who-has-to-report-their-money</loc>',
    );
    expect(body).not.toContain('?page=');
  });

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

  it('responds 503 rather than an empty committee sitemap when the backend fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const recorder = responseRecorder();

    await handler({ query: { section: 'committees' } }, recorder.response);

    expect(recorder.read().status).toBe(503);
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
