// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ width: 1600, isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('../../../lib/eventsIndex', () => ({
  EVENT_INDEX: [],
  PUBLISHED_EVENT_INDEX: [],
  eventIndexBySlug: () => undefined,
}));
vi.mock('react-native-svg', () => ({ default: () => null, Path: () => null }));

import { HomeFeatureCards } from '../HomeFeatureCards';
import { homePageSnapshot, renderPageSnapshot } from '../../../lib/pageSnapshot';

describe('homepage respects event publication', () => {
  it('omits an unavailable debate while keeping Legislature and services usable', () => {
    const html = renderToStaticMarkup(<HomeFeatureCards servicesReady />);
    expect(html).not.toContain('/blog/events/forward-debate-2026');
    expect(html).toContain('href="/bills"');
    expect(html).toContain('href="/legislators"');
    expect(html).toContain('href="/services"');
  });

  it('uses the same omission in the first response', () => {
    const html = renderPageSnapshot(homePageSnapshot());
    expect(html).not.toContain('/blog/events/forward-debate-2026');
    expect(html).toContain('href="/bills"');
    expect(html).toContain('href="/legislators"');
    expect(html).toContain('href="/services"');
  });
});
