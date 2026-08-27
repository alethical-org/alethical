import { describe, expect, it, vi } from 'vitest';

import { NAV_ITEM_HREFS, currentNavItemId, navigateTopNavItem } from '../topNavRoutes';

describe('top navigation routes', () => {
  it.each([
    ['search-bills', ['Bills']],
    ['search-legislators', ['Legislators']],
    ['search-find-my-legislator', ['FindMyLegislator']],
    ['search-campaign-money', ['MoneyLanding']],
    ['read', ['Read']],
    ['about-us', ['AboutUs']],
    ['about-site-metrics', ['SiteMetrics']],
    ['about-contact', ['ContactUs']],
  ] as const)('sends %s through the full app route', (itemId, expectedCall) => {
    const navigate = vi.fn();

    expect(navigateTopNavItem({ navigate }, { id: itemId })).toBe(true);
    expect(navigate).toHaveBeenCalledWith(...expectedCall);
  });

  it('uses the full nested route to Tracked from a child page', () => {
    const rootNavigate = vi.fn();
    const root = { navigate: rootNavigate };
    const child = {
      navigate: vi.fn(),
      getParent: () => root,
    };

    expect(navigateTopNavItem(child, { id: 'track-bills' })).toBe(true);
    expect(rootNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Tracked' });
  });

  it('leaves a roadmap row with no page for its caller to handle', () => {
    const navigate = vi.fn();

    expect(navigateTopNavItem({ navigate }, { id: 'search-candidates' })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

// The 2 maps in topNavRoutes.ts have to agree: a row whose click navigates but
// whose link is missing renders as a plain control with no URL, which is the
// defect #764 fixed once already for Find My Legislator.
describe('a nav row that navigates also carries a link', () => {
  it.each([
    'search-bills',
    'search-legislators',
    'search-find-my-legislator',
    'search-campaign-money',
    'read',
    'about-us',
    'about-site-metrics',
    'about-contact',
    'track-bills',
  ])('%s has an href', (itemId) => {
    expect(NAV_ITEM_HREFS[itemId]).toBeTruthy();
  });
});

// Marking the row a reader is on. Nothing in the nav did this until 27 Aug 2026,
// though the bill header, the section rail, the profile tabs and the search
// dropdowns all mark their own current thing.
describe('the nav row that names the page being viewed', () => {
  it('marks Read on the /read page', () => {
    expect(currentNavItemId('/read')).toBe('read');
  });

  it('ignores a trailing slash, a query and a fragment', () => {
    expect(currentNavItemId('/read/')).toBe('read');
    expect(currentNavItemId('/bills?q=water&page=2')).toBe('search-bills');
    expect(currentNavItemId('/money#lanes')).toBe('search-campaign-money');
  });

  it('marks the Money in politics row on /money, and never the Search menu', () => {
    // A dropdown trigger opens a panel and is not a page, so it can never be
    // named here: this returns row ids only, and 'search' is not one.
    expect(currentNavItemId('/money')).toBe('search-campaign-money');
    expect(Object.keys(NAV_ITEM_HREFS)).not.toContain('search');
    expect(Object.keys(NAV_ITEM_HREFS)).not.toContain('about');
  });

  it('marks nothing on a page below a nav row', () => {
    // `aria-current="page"` claims "this link is the page you are on", so a
    // piece's own page is not the /read page and the home page is no row at all.
    expect(currentNavItemId('/read/guides/who-has-to-report-their-money')).toBeNull();
    expect(currentNavItemId('/read/research/the-money-only-goes-one-way')).toBeNull();
    expect(currentNavItemId('/money/committees')).toBeNull();
    expect(currentNavItemId('/')).toBeNull();
  });
});
