// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Circle: () => <circle />,
  Path: (props: { d?: string }) => <path d={props.d} />,
  Rect: () => <rect />,
}));

vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'reader-1',
      name: 'Marissa Chen',
      email: 'marissa@example.com',
      signInMethods: { google: true, password: false },
    },
    signOut: auth.signOut,
  }),
}));

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

vi.mock('../SignInContainer', () => ({ SignInContainer: () => null }));

import { AccountAvatarButton, AccountNavButton } from '../AccountControl';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type SignOutResult = { ok: boolean };

function deferred() {
  let resolve!: (result: SignOutResult) => void;
  const promise = new Promise<SignOutResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function button(label: string) {
  const result = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (element) => element.getAttribute('aria-label') === label,
  );
  expect(result, `button ${label}`).toBeDefined();
  return result!;
}

function signOutButton() {
  const result = document.querySelector<HTMLElement>('[data-account-menu-sign-out="true"]');
  expect(result).not.toBeNull();
  return result!;
}

function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

let root: Root;
let mount: HTMLDivElement;

beforeEach(() => {
  auth.signOut.mockReset();
  window.sessionStorage.clear();
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});

afterEach(() => {
  act(() => root.unmount());
  mount.remove();
  window.sessionStorage.clear();
});

describe.each([
  ['desktop menu', <AccountNavButton />, 'Account panel for Marissa Chen'],
  ['phone sheet', <AccountAvatarButton />, 'Account menu'],
] as const)('%s sign out', (_surface, control, openerLabel) => {
  it('keeps one focused action during the request, then shows a failure above its retry', async () => {
    const first = deferred();
    const second = deferred();
    auth.signOut.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    act(() => root.render(control));
    click(button(openerLabel));

    const action = signOutButton();
    expect(action.textContent).toBe('Sign out');
    const icon = action.querySelector('svg')?.innerHTML;
    expect(icon).toBeTruthy();
    act(() => action.focus());
    click(action);

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(signOutButton()).toBe(action);
    expect(action.textContent).toBe('Signing out…');
    expect(action.querySelector('svg')?.innerHTML).toBe(icon);
    expect(action.getAttribute('aria-busy')).toBe('true');
    expect(action.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(action);

    click(action);
    expect(auth.signOut).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({ ok: false }));

    expect(signOutButton()).toBe(action);
    expect(action.textContent).toBe('Try again');
    expect(action.getAttribute('aria-busy')).toBeNull();
    expect(action.getAttribute('aria-disabled')).toBeNull();
    const alert = document.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toBe(
      'We couldn’t sign you out. Check your connection and try again.',
    );
    expect(alert!.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(action);

    click(action);
    expect(auth.signOut).toHaveBeenCalledTimes(2);
    expect(action.textContent).toBe('Signing out…');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => second.resolve({ ok: false }));
  });

  it('clears saved sign-in drafts only after sign out succeeds', async () => {
    const request = deferred();
    auth.signOut.mockReturnValue(request.promise);
    window.sessionStorage.setItem('alethical.pendingSignIn', 'draft');
    window.sessionStorage.setItem('alethical.openSignIn', 'draft');

    act(() => root.render(control));
    click(button(openerLabel));
    click(signOutButton());

    expect(window.sessionStorage.getItem('alethical.pendingSignIn')).toBe('draft');
    await act(async () => request.resolve({ ok: true }));
    expect(window.sessionStorage.getItem('alethical.pendingSignIn')).toBeNull();
    expect(window.sessionStorage.getItem('alethical.openSignIn')).toBeNull();
  });
});
