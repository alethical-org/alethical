import { describe, expect, it, vi } from 'vitest';

import { navigateTopNavItem } from '../topNavRoutes';

describe('top navigation routes', () => {
  it.each([
    ['search-bills', ['Bills']],
    ['search-legislators', ['Legislators']],
    ['search-find-my-legislator', ['FindMyLegislator']],
    ['about-us', ['AboutUs']],
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
