// @vitest-environment jsdom

import { act, cloneElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED = 'true';
  return {
    methods: { google: true, password: false } as { google: boolean; password: boolean } | null,
    bills: [] as object[] | undefined,
    committees: [] as object[] | undefined,
    admin: 'pending',
    navigate: vi.fn(),
  };
});

vi.mock('react-native-svg', () => ({
  default: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Path: () => <path />,
  Rect: () => <rect />,
}));
vi.mock('../../../providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'reader-1',
      name: 'Marissa Chen',
      email: 'marissa@example.com',
      signInMethods: state.methods,
    },
    signOut: vi.fn(),
  }),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: state.navigate }),
}));
vi.mock('../../../hooks/useAppQueries', () => ({
  useTrackedBills: () => ({ data: state.bills }),
  useTrackedCommittees: () => ({ data: state.committees }),
}));
vi.mock('../../../hooks/useAdminAccess', () => ({
  useAdminAccess: () => ({ state: state.admin }),
}));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../SignInContainer', () => ({ SignInContainer: () => null }));

import { AccountDrawerRow, AccountNavButton } from '../AccountControl';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mount: HTMLDivElement;

beforeEach(() => {
  state.methods = { google: true, password: false };
  state.bills = [];
  state.committees = [];
  state.admin = 'pending';
  state.navigate.mockReset();
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount());
  mount.remove();
});

function click(element: HTMLElement) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
}

function render(control: ReactElement) {
  act(() => root.render(cloneElement(control)));
}

function row(label: string) {
  return [...document.querySelectorAll<HTMLElement>('[data-account-menu-row]')].find(
    (element) => element.textContent?.trim() === label,
  );
}

describe.each([
  ['desktop', <AccountNavButton compact />, 'Account panel for Marissa Chen'],
  ['drawer', <AccountDrawerRow />, 'Account for Marissa Chen'],
] as const)('%s account states', (_surface, control, openerLabel) => {
  function open() {
    render(control);
    const opener = document.querySelector<HTMLElement>(`[aria-label="${openerLabel}"]`);
    expect(opener).not.toBeNull();
    click(opener!);
  }

  it('prints a combined count only after both lists arrive, and hides empty counts', () => {
    state.bills = [{}, {}];
    state.committees = undefined;
    open();
    expect(row('Tracked')).toBeDefined();
    expect(row('Tracked')?.getAttribute('aria-label')).toBeNull();

    state.committees = [{}];
    render(control);
    expect(document.querySelector('[aria-label="Tracked, 3"]')?.textContent).toBe('Tracked3');

    state.bills = [];
    state.committees = [];
    render(control);
    expect(row('Tracked')).toBeDefined();
    expect(document.querySelector('[aria-label="Tracked, 0"]')).toBeNull();

    state.bills = undefined;
    render(control);
    expect(row('Tracked')).toBeDefined();
    expect(row('Tracked')?.getAttribute('aria-label')).toBeNull();
  });

  it('keeps password wording tied to the account, including unknown sign-in methods', () => {
    open();
    expect(row('Add a password')).toBeDefined();
    state.methods = { google: true, password: true };
    render(control);
    expect(row('Change password')).toBeDefined();
    state.methods = null;
    render(control);
    expect(row('Password')).toBeDefined();
    expect(row('Change password')).toBeUndefined();
  });

  it('shows the 3 administrator links only after access is allowed', () => {
    open();
    expect(row('User Accounts')).toBeUndefined();
    state.admin = 'restricted';
    render(control);
    expect(row('User Accounts')).toBeUndefined();
    state.admin = 'allowed';
    render(control);
    const links = ['User Accounts', 'Site Metrics', 'Operations'].map((label) => row(label));
    expect(links.map((element) => element?.getAttribute('href'))).toEqual([
      '/admin/users',
      '/admin/site-metrics',
      '/admin/operations',
    ]);
    expect(
      links[0]!.compareDocumentPosition(links[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      links[1]!.compareDocumentPosition(links[2]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    click(links[0]!);
    expect(state.navigate).toHaveBeenCalledWith('AdminUsers');
    expect(row('User Accounts')).toBeUndefined();
  });
});
