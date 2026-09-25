// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const mocks = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    isSignedIn: false,
    accessToken: null as string | null,
    user: null as null | { id: string; email: string },
  },
  openSignIn: vi.fn(),
  createIntent: vi.fn(),
  completeIntent: vi.fn(),
  read: vi.fn(),
}));
vi.mock('../../../providers/AuthProvider', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../providers/signInModalContext', () => ({
  useSignInModal: () => ({ openSignIn: mocks.openSignIn }),
}));
vi.mock('../../../data/emailSubscriptions', () => ({
  createEmailSubscriptionIntent: mocks.createIntent,
  completeEmailSubscriptionIntent: mocks.completeIntent,
  readEmailPreferences: mocks.read,
  ApiError: class extends Error {},
}));
vi.mock('../../../lib/emailSubscriptionIntent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/emailSubscriptionIntent')>()),
  newEmailSubscriptionBrowserKey: () => 'fake-browser-key-for-signup-test-case-1',
}));
vi.mock('../UnconcealedConfirmation', async () => {
  const { Text } = await import('react-native');
  return {
    UnconcealedConfirmation: ({ open }: { open: boolean }) =>
      open ? <Text>Confirmation open</Text> : null,
  };
});
vi.mock('@react-navigation/native', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
  };
});

import {
  markEmailSubscriptionIntentAuthReady,
  readEmailSubscriptionIntent,
  saveEmailSubscriptionIntent,
} from '../../../lib/emailSubscriptionIntent';
import { UnconcealedInvite } from '../UnconcealedInvite';

let root: Root;
let host: HTMLElement;
const onPreferences = vi.fn();
function render() {
  act(() =>
    root.render(
      <UnconcealedInvite isMobile={false} isTablet={false} onPreferences={onPreferences} />,
    ),
  );
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
function button(label: string) {
  const result = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((node) =>
    node.textContent?.includes(label),
  );
  expect(result).toBeDefined();
  return result!;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  sessionStorage.clear();
  mocks.auth.isLoading = false;
  mocks.auth.isSignedIn = false;
  mocks.auth.accessToken = null;
  mocks.auth.user = null;
  mocks.openSignIn.mockReset();
  onPreferences.mockReset();
  mocks.createIntent.mockReset().mockResolvedValue('fake-reference-for-signup-test-case-1');
  mocks.completeIntent.mockReset().mockResolvedValue(true);
  mocks.read.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Unconcealed signup invitation', () => {
  it('starts the ordinary account flow without subscribing anyone', async () => {
    render();
    await act(async () => {
      button('Get Unconcealed by email').click();
    });
    expect(mocks.createIntent).toHaveBeenCalledWith('fake-browser-key-for-signup-test-case-1');
    expect(mocks.openSignIn).toHaveBeenCalledWith({ intent: 'newsletter', returnTo: '/money' });
    expect(readEmailSubscriptionIntent()?.authReady).toBe(false);
    expect(mocks.completeIntent).not.toHaveBeenCalled();
  });

  it('lets a reader choose emails in account settings when signup cannot open', async () => {
    mocks.createIntent.mockRejectedValue(new Error('service unavailable'));
    render();
    await act(async () => {
      button('Get Unconcealed by email').click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('We couldn’t open email signup');
    act(() => button('Choose emails in account settings').click());
    expect(onPreferences).toHaveBeenCalledTimes(1);
    expect(mocks.openSignIn).not.toHaveBeenCalled();
    expect(mocks.completeIntent).not.toHaveBeenCalled();
  });

  it('waits for completed account creation before opening confirmation', async () => {
    saveEmailSubscriptionIntent({
      reference: 'fake-reference-for-signup-test-case-2',
      browserKey: 'fake-browser-key-for-signup-test-case-2',
      authReady: false,
    });
    mocks.auth.isSignedIn = true;
    mocks.auth.accessToken = 'token-a';
    mocks.auth.user = { id: 'account-a', email: 'a@example.com' };
    mocks.read.mockResolvedValue({
      account_id: 'account-a',
      email: 'a@example.com',
      research: null,
      features: null,
      version: 0,
    });
    render();
    await settle();
    expect(mocks.completeIntent).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Confirmation open');
    act(() => markEmailSubscriptionIntentAuthReady());
    await settle();
    expect(mocks.completeIntent).toHaveBeenCalledWith(
      'token-a',
      'fake-reference-for-signup-test-case-2',
      'fake-browser-key-for-signup-test-case-2',
    );
    expect(host.textContent).toContain('Confirmation open');
  });

  it('does not show an old account’s confirmation after switching accounts during completion', async () => {
    let finish!: (value: boolean) => void;
    mocks.completeIntent.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    saveEmailSubscriptionIntent({
      reference: 'fake-reference-for-signup-test-case-3',
      browserKey: 'fake-browser-key-for-signup-test-case-3',
      authReady: true,
    });
    mocks.auth.isSignedIn = true;
    mocks.auth.accessToken = 'token-a';
    mocks.auth.user = { id: 'account-a', email: 'a@example.com' };
    mocks.read.mockResolvedValue({
      account_id: 'account-a',
      email: 'a@example.com',
      research: null,
      features: null,
      version: 0,
    });
    render();
    await settle();
    expect(mocks.completeIntent).toHaveBeenCalledTimes(1);
    mocks.auth.accessToken = 'token-b';
    mocks.auth.user = { id: 'account-b', email: 'b@example.com' };
    render();
    await act(async () => {
      finish(true);
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain('Confirmation open');
    expect(readEmailSubscriptionIntent()).toBeNull();
  });
});
