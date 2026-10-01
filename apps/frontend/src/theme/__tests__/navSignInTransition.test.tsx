// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ openSignIn: vi.fn(), onDismiss: () => {}, isMobile: true }));
vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  G: ({ children }: { children?: ReactNode }) => <g>{children}</g>,
  Path: () => <path />,
  Rect: () => <rect />,
  Polygon: () => <polygon />,
  Polyline: () => <polyline />,
  Line: () => <line />,
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useRoute: () => ({ name: 'Read' }),
}));
vi.mock('../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: state.isMobile, isDesktop: false }),
}));
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => ({ isSignedIn: false }) }));
vi.mock('../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: state.openSignIn }),
}));
vi.mock('../../components/auth/accountControls', () => ({
  AccountAvatarButton: () => null,
  AccountDrawerRow: () => null,
  AccountNavButton: () => null,
}));
vi.mock('react-native', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-native')>();
  return {
    ...real,
    // The browser's drawer restores its opener when dismissal completes.
    // Hold that boundary open so a regression cannot race Sign in against it.
    Modal: ({ visible, children, onDismiss }: any) => {
      state.onDismiss = onDismiss;
      return visible ? children : null;
    },
  };
});

import { TopNav } from '../primitives';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  state.openSignIn.mockClear();
  state.isMobile = true;
  document.body.innerHTML = '';
});

describe('phone menu to Sign in', () => {
  it('closes from the phone header without opening Sign in or adding a keyboard stop', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<TopNav />));
    act(() => document.querySelector<HTMLElement>('[aria-label="Open menu"]')!.click());
    const closeArea = document.querySelector<HTMLElement>(
      '[data-testid="menu-header-close-area"]',
    )!;
    expect(closeArea).toBeTruthy();
    expect(closeArea.tabIndex).toBe(-1);
    act(() => closeArea.click());
    expect(document.querySelector('[data-testid="menu-header-close-area"]')).toBeNull();
    expect(document.querySelector('[aria-label="Open menu"]')).toBeTruthy();
    expect(state.openSignIn).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('keeps the tablet header separate from the phone closing area', () => {
    state.isMobile = false;
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<TopNav />));
    act(() => document.querySelector<HTMLElement>('[aria-label="Open menu"]')!.click());
    expect(document.querySelector('[data-testid="menu-header-close-area"]')).toBeNull();
    act(() => root.unmount());
  });

  it('opens Sign in after the drawer restores its opener, once per press', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    act(() => root.render(<TopNav />));
    const opener = document.querySelector<HTMLElement>('[aria-label="Open menu"]')!;
    act(() => opener.click());
    const signIn = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(
      (node) => node.textContent === 'Sign in',
    )!;
    expect(signIn).toBeTruthy();
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a')];
    const candidate = links.find((node) => node.getAttribute('href') === '/candidates')!;
    const legislator = links.find((node) => node.getAttribute('href') === '/find-my-legislator')!;
    expect(candidate.textContent).toBe('Find my candidatesNEW');
    expect(
      candidate.compareDocumentPosition(legislator) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain('ON THE ROADMAPCandidates');
    act(() => signIn.click());
    expect(state.openSignIn).not.toHaveBeenCalled();
    act(() => {
      opener.focus();
      state.onDismiss();
    });
    expect(state.openSignIn).toHaveBeenCalledExactlyOnceWith({ intent: 'nav' });
    expect(document.activeElement).toBe(opener);
    act(() => state.onDismiss());
    expect(state.openSignIn).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
