// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('../../../lib/research', async (load) => ({
  ...(await load<typeof import('../../../lib/research')>()),
  publishedResearch: () => [],
}));
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../theme/primitives', async () => {
  const { View } = await import('react-native');
  return {
    PageBackground: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    TopNav: () => null,
    Footer: () => null,
  };
});
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <svg {...props}>{children}</svg>,
  Path: (props: object) => <path {...props} />,
  Circle: (props: object) => <circle {...props} />,
  Polygon: (props: object) => <polygon {...props} />,
}));

import { ShortPostsScreen } from '../ShortPostsScreen';

it('gives an empty collection one underlinable label and a separate shared arrow', () => {
  const html = renderToStaticMarkup(
    <ShortPostsScreen
      navigation={{ navigate: vi.fn() } as any}
      route={{ name: 'ShortPosts', params: {} } as any}
    />,
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  const link = host.querySelector<HTMLAnchorElement>('.sp-collection-empty a');
  expect(link?.getAttribute('href')).toBe('/blog');
  expect(link?.children).toHaveLength(2);
  expect(link?.children[0].tagName).toBe('svg');
  expect(link?.children[0].getAttribute('aria-hidden')).toBe('true');
  expect(link?.children[1].textContent).toBe('Back to Blog');
  expect(host.querySelector('style')?.textContent).toContain(
    '.sp-collection-empty a:hover span{text-decoration:underline}',
  );
});
