import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { recordSiteMetricEventFromApi } = vi.hoisted(() => ({
  recordSiteMetricEventFromApi: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../data/api', () => ({ recordSiteMetricEventFromApi }));

let { recordOfficialSourceOpen, recordSiteMetricEvent, setSiteMetricSession } =
  await import('../siteMetricEvents');

beforeEach(async () => {
  vi.resetModules();
  ({ recordOfficialSourceOpen, recordSiteMetricEvent, setSiteMetricSession } =
    await import('../siteMetricEvents'));
});

afterEach(() => {
  setSiteMetricSession(null, true);
  vi.mocked(recordSiteMetricEventFromApi).mockClear();
  vi.unstubAllGlobals();
});

describe('privacy-safe Site Metrics events', () => {
  it('drops private administration actions instead of queuing them', () => {
    vi.stubGlobal('window', {
      location: { href: 'https://www.alethical.com/admin/users?email=private' },
    });
    setSiteMetricSession(null, false);
    recordSiteMetricEvent('official_source_opened');
    vi.stubGlobal('window', { location: { href: 'https://www.alethical.com/bills' } });
    setSiteMetricSession(null, true);
    expect(recordSiteMetricEventFromApi).not.toHaveBeenCalled();
  });

  it('drops queued public actions if delivery occurs at a private address', () => {
    setSiteMetricSession(null, false);
    recordSiteMetricEvent('official_source_opened');
    vi.stubGlobal('window', { location: { href: 'https://www.alethical.com/admin' } });
    setSiteMetricSession(null, true);
    expect(recordSiteMetricEventFromApi).not.toHaveBeenCalled();
  });

  it('sends only the fixed action name and the in-memory sign-in token', () => {
    setSiteMetricSession('private-session-token', true);
    recordSiteMetricEvent('bill_search_with_results');

    expect(recordSiteMetricEventFromApi).toHaveBeenCalledWith(
      'bill_search_with_results',
      'private-session-token',
    );
  });

  it('waits for the sign-in check before sending an early event', () => {
    setSiteMetricSession(null, false);
    recordSiteMetricEvent('legislator_search_with_results');

    expect(recordSiteMetricEventFromApi).not.toHaveBeenCalled();

    setSiteMetricSession('team-session-token', true);
    expect(recordSiteMetricEventFromApi).toHaveBeenCalledWith(
      'legislator_search_with_results',
      'team-session-token',
    );
  });

  it.each([null, 'test-reader-token', 'test-refreshed-team-token'])(
    'drops actions during a known team account transition to %s',
    (nextToken) => {
      setSiteMetricSession('test-team-token', true);
      // Effect cleanup must not reopen the initial unknown-account queue.
      setSiteMetricSession(null, false);
      setSiteMetricSession('test-team-token', false);
      recordSiteMetricEvent('official_source_opened');
      setSiteMetricSession(null, false);
      recordSiteMetricEvent('bill_search_with_results');
      setSiteMetricSession(nextToken, true);
      expect(recordSiteMetricEventFromApi).not.toHaveBeenCalled();
      recordSiteMetricEvent('legislator_search_with_results');
      expect(recordSiteMetricEventFromApi).toHaveBeenCalledWith(
        'legislator_search_with_results',
        nextToken,
      );
    },
  );

  it('does not reassign startup actions once a token is known but unresolved', () => {
    recordSiteMetricEvent('bill_search_with_results');
    setSiteMetricSession('test-team-token', false);
    recordSiteMetricEvent('official_source_opened');
    setSiteMetricSession(null, true);
    expect(recordSiteMetricEventFromApi).not.toHaveBeenCalled();
  });

  it('bounds startup buffering and flushes it once across effect cleanup', () => {
    setSiteMetricSession(null, false);
    for (let index = 0; index < 100; index++) recordSiteMetricEvent('official_source_opened');
    setSiteMetricSession(null, false);
    setSiteMetricSession('test-reader-token', true);
    expect(recordSiteMetricEventFromApi).toHaveBeenCalledTimes(20);
    setSiteMetricSession(null, false);
    setSiteMetricSession('test-reader-token', true);
    expect(recordSiteMetricEventFromApi).toHaveBeenCalledTimes(20);
    expect(recordSiteMetricEventFromApi).toHaveBeenLastCalledWith(
      'official_source_opened',
      'test-reader-token',
    );
  });

  it.each([
    'https://www.revisor.mn.gov/bills/',
    'https://www.house.mn.gov/sessiondaily/',
    'https://www.senate.mn/',
    'https://gis.lcc.mn.gov/iMaps/districts/',
    'https://cfb.mn.gov/reports-and-data/',
    'https://www.cfb.mn.gov/reports-and-data/',
    'https://leg.mn.gov/leg/faq/faq?id=15',
    'https://www.leg.mn.gov/leg/faq/faq?id=15',
  ])('counts an official Minnesota source without sending its address', (url) => {
    setSiteMetricSession(null, true);
    recordOfficialSourceOpen(url);

    expect(recordSiteMetricEventFromApi).toHaveBeenCalledWith('official_source_opened', null);
    expect(JSON.stringify(vi.mocked(recordSiteMetricEventFromApi).mock.calls)).not.toContain(url);
  });

  it('does not count social, vendor, or malformed links as official sources', () => {
    recordOfficialSourceOpen('https://vercel.com/analytics');
    recordOfficialSourceOpen('https://example.com/');
    recordOfficialSourceOpen('not an address');
    recordOfficialSourceOpen('https://cfb.mn.gov.example.com/');
    recordOfficialSourceOpen('https://notleg.mn.gov/');

    expect(recordSiteMetricEventFromApi).not.toHaveBeenCalled();
  });
});
