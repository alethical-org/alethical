// @vitest-environment jsdom

import { act, cloneElement, useState, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_EMAIL_PASSWORD_SIGN_IN_ENABLED = 'true';
  return {
    methods: { google: true, password: false } as { google: boolean; password: boolean } | null,
    bills: [] as object[] | undefined,
    committees: [] as object[] | undefined,
    admin: 'pending',
    token: undefined as string | undefined,
    count: vi.fn(),
    width: 375,
    navigate: vi.fn(),
  };
});

vi.mock('../../../data/candidateClaims', () => ({ getPendingProfileClaimCount: state.count }));

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
    accessToken: state.token,
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
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({
    width: state.width,
    isMobile: state.width < 768,
    isTablet: state.width >= 768 && state.width < 1100,
    isDesktop: state.width >= 1100,
  }),
}));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../SignInContainer', () => ({ SignInContainer: () => null }));

import { AccountAvatarButton, AccountDrawerRow, AccountNavButton } from '../AccountControl';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mount: HTMLDivElement;

beforeEach(() => {
  state.methods = { google: true, password: false };
  state.bills = [];
  state.committees = [];
  state.admin = 'pending';
  state.token = undefined;
  state.count.mockReset();
  state.width = 375;
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
  ['desktop', <AccountNavButton compact />, 'Account panel for Marissa Chen', 1280, 16],
  ['tablet', <AccountAvatarButton />, 'Account menu', 900, 16],
  ['drawer', <AccountDrawerRow />, 'Account for Marissa Chen', 375, 18],
] as const)('%s account states', (_surface, control, openerLabel, width, labelSize) => {
  function open() {
    state.width = width;
    render(control);
    const opener = document.querySelector<HTMLElement>(`[aria-label="${openerLabel}"]`);
    expect(opener).not.toBeNull();
    click(opener!);
  }

  it('uses the approved action text size for its screen band, including sign-out space', () => {
    state.admin = 'allowed';
    open();
    const labels = [
      'Tracked',
      'Add a password',
      'Email preferences',
      'User Accounts',
      'Site Metrics',
      'Operations',
      'Profile claim requests',
    ];
    for (const label of labels) {
      const text = [...row(label)!.querySelectorAll<HTMLElement>('*')].find(
        (element) => element.children.length === 0 && element.textContent === label,
      );
      expect(text, label).toBeDefined();
      expect(getComputedStyle(text!).fontSize, label).toBe(`${labelSize}px`);
    }
    const signOut = document.querySelector<HTMLElement>('[data-account-menu-sign-out-label]')!;
    expect(getComputedStyle(signOut).fontSize).toBe(`${labelSize}px`);
    const reservedLabel = [...document.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find(
      (element) => element.textContent === 'Signing out…',
    )!;
    expect(getComputedStyle(reservedLabel).fontSize).toBe(`${labelSize}px`);
  });

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

  it('shows the 4 administrator links only after access is allowed', () => {
    open();
    expect(row('User Accounts')).toBeUndefined();
    state.admin = 'restricted';
    render(control);
    expect(row('User Accounts')).toBeUndefined();
    state.admin = 'allowed';
    render(control);
    const links = ['User Accounts', 'Site Metrics', 'Operations', 'Profile claim requests'].map(
      (label) => row(label),
    );
    expect(links.map((element) => element?.getAttribute('href'))).toEqual([
      '/admin/users',
      '/admin/site-metrics',
      '/admin/operations',
      '/admin/candidate-claims',
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

it.each([
  [767, 18],
  [768, 16],
  [1099, 16],
] as const)('keeps sheet geometry with %ipx screen and %ipx action text', (width, fontSize) => {
  state.admin = 'allowed';
  state.width = width;
  const control = <AccountDrawerRow />;
  render(control);
  click(document.querySelector<HTMLElement>('[aria-label="Account for Marissa Chen"]')!);
  const tracked = row('Tracked')!;
  const label = [...tracked.querySelectorAll<HTMLElement>('*')].find(
    (element) => element.children.length === 0 && element.textContent === 'Tracked',
  )!;
  expect(getComputedStyle(label).fontSize).toBe(`${fontSize}px`);
  expect(getComputedStyle(tracked).minHeight).toBe('56px');
  const signOut = document.querySelector<HTMLElement>('[data-account-menu-sign-out]')!;
  expect(getComputedStyle(signOut).minHeight).toBe('56px');
});

it.each(['Tracked', 'Email preferences', 'User Accounts', 'Profile claim requests'])(
  'closes the enclosing phone navigation when %s is selected from its account sheet',
  (label) => {
    state.admin = 'allowed';
    function Navigation() {
      const [open, setOpen] = useState(true);
      return open ? (
        <div aria-label="Site navigation">
          <AccountDrawerRow onNavigate={() => setOpen(false)} />
        </div>
      ) : (
        <p>Destination content</p>
      );
    }
    render(<Navigation />);
    click(document.querySelector<HTMLElement>('[aria-label="Account for Marissa Chen"]')!);
    click(row(label)!);
    expect(document.querySelector('[aria-label="Site navigation"]')).toBeNull();
    expect(document.querySelector('[role="dialog"][aria-label="Account"]')).toBeNull();
    expect(mount.textContent).toContain('Destination content');
    expect(state.navigate).toHaveBeenCalledOnce();
  },
);

it('closing the phone account sheet leaves the enclosing site navigation open', () => {
  const onNavigate = vi.fn();
  render(<AccountDrawerRow onNavigate={onNavigate} />);
  click(document.querySelector<HTMLElement>('[aria-label="Account for Marissa Chen"]')!);
  click(document.querySelector<HTMLElement>('[aria-label="Close"]')!);
  expect(onNavigate).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Account for Marissa Chen"]')).not.toBeNull();
});

it('reads the private pending count only inside the open admin menu and keeps it during refresh', async () => {
  state.admin = 'allowed';
  state.width = 1280;
  state.token = 'test-token';
  let finish!: (value: { pending_count: number }) => void;
  state.count.mockResolvedValueOnce({ pending_count: 4 }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<AccountNavButton compact />);
  expect(state.count).not.toHaveBeenCalled();
  click(document.querySelector<HTMLElement>('[aria-label="Account panel for Marissa Chen"]')!);
  await act(async () => {
    await Promise.resolve();
  });
  expect(
    document.querySelector(
      '[aria-label="Profile claim requests, 4 pending profile claim requests"]',
    ),
  ).not.toBeNull();
  act(() => window.dispatchEvent(new Event('alethical-profile-claims-changed')));
  expect(
    document.querySelector(
      '[aria-label="Profile claim requests, 4 pending profile claim requests"]',
    ),
  ).not.toBeNull();
  await act(async () => finish({ pending_count: 3 }));
  expect(
    document.querySelector(
      '[aria-label="Profile claim requests, 3 pending profile claim requests"]',
    ),
  ).not.toBeNull();
  const request = state.count.mock.calls[1][1] as AbortSignal;
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(request.aborted).toBe(true);
  expect(
    document.querySelector(
      '[aria-label="Profile claim requests, 3 pending profile claim requests"]',
    ),
  ).toBeNull();
});
it('does not invent a zero count after a failed private count request', async () => {
  state.admin = 'allowed';
  state.width = 1280;
  state.token = 'test-token';
  state.count.mockRejectedValue(new Error('Offline'));
  render(<AccountNavButton compact />);
  click(document.querySelector<HTMLElement>('[aria-label="Account panel for Marissa Chen"]')!);
  await act(async () => {
    await Promise.resolve();
  });
  expect(row('Profile claim requests')).toBeDefined();
  expect(
    document.querySelector(
      '[aria-label="Profile claim requests, 0 pending profile claim requests"]',
    ),
  ).toBeNull();
});
