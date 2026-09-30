// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-native-svg', () => ({
  default: ({ children, ...props }: { children: ReactNode }) => <svg {...props}>{children}</svg>,
  Path: (props: object) => <path {...props} />,
  Circle: (props: object) => <circle {...props} />,
  Polygon: (props: object) => <polygon {...props} />,
}));

import { WHO_HAS_TO_REPORT_THEIR_MONEY } from '../../../lib/researchPieces/whoHasToReportTheirMoney';
import { SetBox } from '../SetBox';

it('renders real hover and focus targets around group words, topics and the shared arrow', () => {
  const html = renderToStaticMarkup(
    <SetBox
      group={{
        name: 'How the Money Works',
        slug: 'how-the-money-works',
        pieces: [WHO_HAS_TO_REPORT_THEIR_MONEY],
      }}
      isMobile={false}
      onOpenPiece={vi.fn()}
      showPageLink
    />,
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  const link = host.querySelector<HTMLElement>('[data-set-page-link]');
  expect(link?.getAttribute('href')).toBe('/blog/sets/how-the-money-works');
  expect(link?.getAttribute('aria-label')).toBe('Open the How the Money Works group page');
  expect(link?.children).toHaveLength(2);
  expect(link?.querySelector('[data-set-page-words]')?.textContent).toBe('Open group page');
  expect(link?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(host.querySelector('[data-set-topic-link]')).not.toBeNull();
});
