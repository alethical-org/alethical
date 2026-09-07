import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../data/api', () => ({
  recordSiteMetricEventFromApi: vi.fn(() => Promise.resolve()),
}));

import { recordSiteMetricEventFromApi } from '../../data/api';
import {
  recordOfficialSourceOpen,
  recordSiteMetricEvent,
  setSiteMetricSession,
} from '../siteMetricEvents';

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
