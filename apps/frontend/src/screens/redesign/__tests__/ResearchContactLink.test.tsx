// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mocks.navigate }),
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: true, isTablet: false }),
}));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../components/billDetail/interactions', () => ({
  useHover: () => [false, {}],
}));
vi.mock('../../../components/billDetail/SharePopover', () => ({ SharePopover: () => null }));
vi.mock('../../../components/comments/ReaderComments', () => ({ ReaderComments: () => null }));
vi.mock('../../../components/shortPosts/ShortPostArticle', () => ({
  ShortPostArticle: () => null,
  ShortPostRelatedReading: () => null,
}));
vi.mock('../../../theme/primitives', async () => {
  const { View } = await import('react-native');
  return {
    PageBackground: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    Container: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    TopNav: () => null,
    Footer: () => null,
  };
});

import { MONEY_ONLY_GOES_ONE_WAY } from '../../../lib/researchPieces/moneyOnlyGoesOneWay';
import { WHO_HAS_TO_REPORT_THEIR_MONEY } from '../../../lib/researchPieces/whoHasToReportTheirMoney';
import { ResearchScreen } from '../ResearchScreen';

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.navigate.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

for (const piece of [MONEY_ONLY_GOES_ONE_WAY, WHO_HAS_TO_REPORT_THEIR_MONEY]) {
  it(`opens ${piece.slug}'s correction form from the rendered closing note`, async () => {
    await act(async () => {
      root.render(
        <ResearchScreen
          navigation={{ navigate: mocks.navigate } as any}
          route={
            {
              name: piece.traits.research ? 'Research' : 'Guide',
              params: { slug: piece.slug },
            } as any
          }
        />,
      );
    });
    const link = [...host.querySelectorAll<HTMLAnchorElement>('a')].find(
      (anchor) => anchor.textContent === 'Contact us',
    );
    expect(link).toBeDefined();
    const article = piece.articleId ?? piece.slug;
    expect(link!.getAttribute('href')).toBe(
      `/about/contact?article=${encodeURIComponent(article)}`,
    );

    await act(async () => {
      link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(mocks.navigate).toHaveBeenCalledWith('ContactUs', { article });

    mocks.navigate.mockClear();
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    await act(async () => link!.dispatchEvent(modified));
    expect(modified.defaultPrevented).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
}
