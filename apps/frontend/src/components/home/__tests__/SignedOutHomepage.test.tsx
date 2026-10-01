// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Bill } from '../../../data/types';
import { HOME_PUBLIC_INTRO } from '../../../lib/homepage';
import { SignedOutHomepage } from '../SignedOutHomepage';

const state = vi.hoisted(() => ({
  width: 1440,
  news: [] as { id: string }[],
  newsLoading: false,
  focused: true,
  featured: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => state.focused,
  useNavigation: () => ({ navigate: state.navigate }),
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: state.width,
    isMobile: state.width < 768,
    isTablet: state.width >= 768 && state.width < 1100,
    isDesktop: state.width >= 1100,
  }),
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useCampaignFinanceSummary: () => ({
    data: { register: { filerCount: 1603 } },
    isLoading: false,
  }),
  useFeaturedBills: (ids: string[], options: { enabled: boolean }) => {
    state.featured(ids, options);
    return { data: state.news, isLoading: state.newsLoading };
  },
}));
// Keep the actual homepage and cards; shared navigation/footer providers are
// unrelated to whether the page places or nests its destination links correctly.
vi.mock('../../../theme/primitives', () => ({
  Container: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PageBackground: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TopNav: () => <nav data-testid="top-nav" />,
  Footer: () => <footer data-testid="footer">Footer</footer>,
}));
vi.mock('react-native-svg', () => ({
  default: () => null,
  Path: () => null,
  Circle: () => null,
  Polygon: () => null,
}));

const moduleRequire = createRequire(import.meta.url);
const originalSvg = moduleRequire.extensions['.svg'];
beforeAll(() => {
  moduleRequire.extensions['.svg'] = (module) => {
    module.exports = { uri: '/mn-outline.svg' };
  };
});
afterAll(() => {
  if (originalSvg) moduleRequire.extensions['.svg'] = originalSvg;
  else delete moduleRequire.extensions['.svg'];
});

function render(options?: { servicesReady?: boolean }) {
  const example = vi.fn(() => <div data-testid="answer-example">Cited answer example</div>);
  const news = vi.fn((bill: Bill) => <article data-bill-id={bill.id}>{bill.id}</article>);
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(
    <SignedOutHomepage {...options} renderExample={example} renderNews={news} />,
  );
  return { page, example, news };
}

beforeEach(() => {
  state.width = 1440;
  state.news = [];
  state.newsLoading = false;
  state.focused = true;
  vi.clearAllMocks();
});

describe('signed-out homepage destinations', () => {
  it.each([1440, 900, 375])('gives each card 1 real link at %ipx', (width) => {
    state.width = width;
    const { page } = render({ servicesReady: true });
    expect(page.textContent).toContain(HOME_PUBLIC_INTRO);

    for (const [href, heading, action] of [
      ['/money', 'Follow the money', 'Search the money records'],
      ['/bills', 'Bills and votes', 'Search bills'],
      ['/services', 'Campaign services', 'Explore our services'],
    ]) {
      const matches = page.querySelectorAll(`a[href="${href}"]`);
      expect(matches).toHaveLength(1);
      const card = matches[0];
      expect(card.textContent).toContain(heading);
      expect(card.textContent).toContain(action);
      expect(card.getAttribute('tabindex')).toBe('0');
      expect(card.querySelectorAll('a, button, [role="button"], [tabindex="0"]')).toHaveLength(0);
    }
  });

  it('shows launched services and the working candidate address form', () => {
    const { page } = render();
    expect(page.querySelector('a[href="/services"]')).not.toBeNull();
    expect(page.querySelector('a[href="/candidates"]')).toBeNull();
    expect(page.querySelector('textarea[autocomplete="street-address"]')).not.toBeNull();
    expect(page.textContent).toContain('Campaign services');
    expect(page.textContent).toContain('Find my candidates');
    expect(page.textContent).toContain('who is running for office');
    expect(page.querySelectorAll('a')).toHaveLength(3);
  });

  it('keeps the editorial answer on desktop and tablet only', () => {
    for (const width of [1440, 900]) {
      state.width = width;
      const { page, example } = render();
      expect(page.querySelector('[data-testid="answer-example"]')).not.toBeNull();
      expect(example).toHaveBeenCalledOnce();
      expect(state.featured).toHaveBeenLastCalledWith(['94-2026-HF4138', '94-2025-SF856'], {
        enabled: false,
      });
    }
    state.width = 375;
    const { page, example } = render();
    expect(page.querySelector('[data-testid="answer-example"]')).toBeNull();
    expect(example).not.toHaveBeenCalled();
  });
});

describe('phone news placement and bill identity', () => {
  it('shows the correct records in editorial order directly before the footer', () => {
    state.width = 375;
    // A query may return records in a different order from the editor's pins.
    state.news = [{ id: '94-2025-SF856' }, { id: '94-2026-HF4138' }];
    const { page } = render();
    expect(state.featured).toHaveBeenLastCalledWith(['94-2026-HF4138', '94-2025-SF856'], {
      enabled: true,
    });
    expect([...page.querySelectorAll('article')].map((node) => node.dataset.billId)).toEqual([
      '94-2026-HF4138',
      '94-2025-SF856',
    ]);
    const text = page.textContent ?? '';
    expect(text.indexOf('In the news')).toBeGreaterThan(text.indexOf('Bills and votes'));
    expect(text.indexOf('Footer')).toBeGreaterThan(text.indexOf('94-2025-SF856'));
    expect(text).not.toContain('SF3933');
    expect(text).not.toContain('Find My Legislator');
    expect(text).not.toContain('Legislative Bill Activity');
  });

  it('shows loading placeholders without inventing news records', () => {
    state.width = 375;
    state.newsLoading = true;
    const { page, news } = render();
    expect(
      page.querySelectorAll('[aria-label="Loading news bill"][aria-busy="true"]'),
    ).toHaveLength(2);
    expect(news).not.toHaveBeenCalled();
  });

  it('omits the news section when no records are available', () => {
    state.width = 375;
    const { page } = render();
    expect(page.textContent).not.toContain('In the news');
    expect(page.querySelector('article')).toBeNull();
  });
});
