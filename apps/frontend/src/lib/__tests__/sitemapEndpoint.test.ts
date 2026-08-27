import { afterEach, describe, expect, it, vi } from 'vitest';

import handler from '../../../../../api/sitemap';

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
  it('lists exactly the three child sitemaps and makes no network call', async () => {
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
    expect(body.match(/<sitemap>/g)).toHaveLength(3);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists fixed pages plus every numbered directory page from current record counts', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          bill_directory_total: 21,
          legislator_directory_total: 13,
          bills: Array.from({ length: 21 }, (_, index) => ({ id: `bill-${index + 1}` })),
          legislators: Array.from({ length: 13 }, (_, index) => ({ slug: `member-${index + 1}` })),
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
      '/reading',
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
    // A published piece is in the sitemap from the day it posts, so the count
    // grows with every piece we publish rather than staying fixed.
    expect(body).toContain(
      '<loc>https://www.alethical.com/reading/research/the-money-only-goes-one-way</loc>',
    );
    // A guide is listed at its own folder, from the same registry.
    expect(body).toContain(
      '<loc>https://www.alethical.com/reading/guides/who-has-to-report-their-money</loc>',
    );
    expect(body.match(/<url>/g)).toHaveLength(17);
    // The addresses the /reading page and its pieces used to answer on are
    // forwarded, never listed: a sitemap row for an address that answers with a
    // permanent forward asks Google to crawl a redirect
    // (docs/architecture/published-writing-decisions.md §2.8).
    for (const retired of ['/reports', '/reports/the-money-only-goes-one-way', '/money/reports']) {
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
    expect(body.match(/<url>/g)).toHaveLength(14);
    expect(body).toContain(
      '<loc>https://www.alethical.com/reading/research/the-money-only-goes-one-way</loc>',
    );
    expect(body).toContain(
      '<loc>https://www.alethical.com/reading/guides/who-has-to-report-their-money</loc>',
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

  it('responds 404 for an unknown section', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const recorder = responseRecorder();

    await handler({ query: { section: 'nonsense' } }, recorder.response);

    expect(recorder.read().status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
