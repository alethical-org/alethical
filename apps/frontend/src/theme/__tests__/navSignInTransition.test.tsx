// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ openSignIn: vi.fn(), onDismiss: () => {} }));
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
  useResponsive: () => ({ isMobile: true, isDesktop: false }),
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
  document.body.innerHTML = '';
});

describe('phone menu to Sign in', () => {
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
