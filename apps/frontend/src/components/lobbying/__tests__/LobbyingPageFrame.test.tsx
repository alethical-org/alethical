// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
vi.mock('../../../hooks/useHistoryScrollRestoration', () => ({
  useHistoryScrollRestoration: () => ({}),
}));
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock('../../../navigation/webHistory', () => ({ hasInAppBackEntry: () => true }));
vi.mock('../../../theme/primitives', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Footer: () => null,
  PageBackground: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TopNav: () => null,
}));
vi.mock('../../billDetail/SharePopover', () => ({ SharePopover: () => null }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Path: () => null,
}));

import { LobbyingPageFrame } from '../LobbyingPageFrame';

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

it('opens the lobbying landing even when this tab has an earlier app page', () => {
  const onBack = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <LobbyingPageFrame onBack={onBack} onHome={() => undefined} title="Example">
        <div>Body</div>
      </LobbyingPageFrame>,
    );
  });

  const link = [...host.querySelectorAll<HTMLAnchorElement>('a')].find(
    (candidate) => candidate.textContent === 'Back to Lobbying',
  );
  expect(link?.getAttribute('href')).toBe('/money/lobbying');
  act(() => link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  expect(onBack).toHaveBeenCalledOnce();
});
