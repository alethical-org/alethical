// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ ok: true }) as const),
}));

vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: '1',
      name: 'Marissa Chen',
      email: 'marissa@example.com',
      signInMethods: { google: true, password: false },
    },
    signOut: auth.signOut,
  }),
}));

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: () => <path />,
}));

// The Tracked row reads the watchlist and the navigator, and the admin group
// reads its own access check. All three are mocked at the boundary, matching
// AccountControlPassword: the real modules pull in React Native sources Node
// cannot parse, so importing this component at all would fail otherwise.
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock('../../../hooks/useAppQueries', () => ({
  useTrackedBills: () => ({ data: [] }),
  useTrackedCommittees: () => ({ data: [] }),
}));

vi.mock('../../../hooks/useAdminAccess', () => ({
  useAdminAccess: () => ({ state: 'denied' }),
}));

vi.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

import { AccountNavButton } from '../AccountControl';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ACCOUNT_BUTTON = '[aria-label="Account panel for Marissa Chen"]';

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function mountMenu() {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  act(() => root.render(<AccountNavButton />));

  const button = document.querySelector<HTMLElement>(ACCOUNT_BUTTON);
  expect(button).not.toBeNull();
  act(() => button?.click());
  expect(document.querySelector('[aria-label="Account"]')).not.toBeNull();

  return { root, button: button as HTMLElement };
}

describe('desktop account menu escape', () => {
  it('returns focus to the account button when Escape closes the menu', () => {
    const { root, button } = mountMenu();

    // A keyboard user tabs into the panel before leaving it, so focus starts on
    // a control inside the menu rather than on the button that opened it.
    const tracked = document.querySelector<HTMLElement>('[aria-label="Account"] [role="button"]');
    expect(tracked).not.toBeNull();
    act(() => tracked?.focus());
    expect(document.activeElement).toBe(tracked);

    act(() => pressEscape());

    expect(document.querySelector('[aria-label="Account"]')).toBeNull();
    expect(document.activeElement).toBe(button);

    act(() => root.unmount());
  });

  it('keeps the menu and the lock while a sign-out request is still running', async () => {
    // A sign-out that never settles holds the flow in its busy state, which is
    // what the lock protects: Escape must not tear the menu down underneath it.
    auth.signOut.mockImplementationOnce(
      () => new Promise(() => {}) as unknown as Promise<{ ok: true }>,
    );
    const { root } = mountMenu();

    const signOut = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(
      (node) => node.textContent?.trim() === 'Sign out',
    );
    expect(signOut).not.toBeUndefined();
    await act(async () => {
      signOut?.click();
    });

    act(() => pressEscape());

    expect(document.querySelector('[aria-label="Account"]')).not.toBeNull();

    act(() => root.unmount());
  });
});
