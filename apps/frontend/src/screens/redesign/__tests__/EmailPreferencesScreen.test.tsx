// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const mocks = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    isSignedIn: true,
    accessToken: 'account-token',
    user: { id: 'account-1', email: 'reader@example.com' },
  },
  read: vi.fn(),
  save: vi.fn(),
  openSignIn: vi.fn(),
}));
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: mocks.openSignIn }),
}));
vi.mock('../../../data/emailSubscriptions', () => ({
  readEmailPreferences: mocks.read,
  saveEmailPreferences: mocks.save,
}));
vi.mock('@react-navigation/native', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
  };
});
vi.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false }),
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

import { EmailPreferencesScreen } from '../EmailPreferencesScreen';

let host: HTMLElement;
let root: Root;
const starting = {
  account_id: 'account-1',
  email: 'reader@example.com',
  research: true,
  features: false,
  version: 4,
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.read.mockReset().mockResolvedValue(starting);
  mocks.save.mockReset();
  mocks.openSignIn.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount() {
  await act(async () => {
    root.render(
      <EmailPreferencesScreen navigation={{ navigate: vi.fn() } as any} route={{} as any} />,
    );
    await Promise.resolve();
  });
}
function control(role: string, label: string): HTMLElement {
  const node = [...host.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find((item) =>
    item.textContent?.includes(label),
  );
  expect(node).toBeDefined();
  return node!;
}

it('stops only research emails while leaving feature email choice alone', async () => {
  mocks.save.mockResolvedValue({ ...starting, research: false, version: 5 });
  await mount();
  expect(mocks.save).not.toHaveBeenCalled();
  await act(async () => control('checkbox', 'Unconcealed research').click());
  await act(async () => {
    control('button', 'Save email preferences').click();
    await Promise.resolve();
  });
  expect(mocks.save).toHaveBeenCalledWith(
    'account-token',
    expect.objectContaining({
      research: false,
      expected_version: 4,
      expected_account_id: 'account-1',
      expected_email: 'reader@example.com',
      source: 'preferences',
    }),
  );
  expect(mocks.save.mock.calls[0][1]).not.toHaveProperty('features');
  expect(host.textContent).toContain('Your email preferences are saved');
});

it('changes a focused email choice with Space without changing it twice', async () => {
  await mount();
  const checkbox = control('checkbox', 'Unconcealed research');
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => {
    checkbox.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    checkbox.dispatchEvent(
      new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }),
    );
  });
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
});

it('offers no controls until the saved choices load', async () => {
  mocks.read.mockRejectedValue(new Error('connection lost'));
  await mount();
  expect(host.textContent).toContain('We couldn’t load your email preferences');
  expect(host.querySelector('[role="checkbox"]')).toBeNull();
  expect(host.textContent).not.toContain('Save email preferences');
});

it('lets a reader stop old emails even without a confirmed account address', async () => {
  mocks.read.mockResolvedValue({ ...starting, email: null });
  mocks.save.mockResolvedValue({ ...starting, email: null, research: false, version: 5 });
  await mount();
  await act(async () => control('checkbox', 'Unconcealed research').click());
  await act(async () => {
    control('button', 'Save email preferences').click();
    await Promise.resolve();
  });
  expect(mocks.save.mock.calls[0][1]).toMatchObject({
    research: false,
    expected_email: null,
  });
  expect(host.textContent).toContain('Your email preferences are saved');
});
